"""AI UI test using a local HTTP model fixture; does NOT validate real DeepSeek."""
import json
import sys
import os
import secrets
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'testing'))
from browser_helpers import ADMIN_PASSWORD, setup_users, register_student, login_teacher
OUT = Path('/tmp/casework-smoke')
OUT.mkdir(exist_ok=True)
scenario = 'valid'
fixture_key = secrets.token_urlsafe(24)
class MockModel(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_POST(self):
        data = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        system = data['messages'][0]['content']
        if 'one property ok' in system:
            content = {'ok': True}
        elif system.startswith('你是社会工作课程'):
            turns = json.loads(data['messages'][1]['content'])['turns']
            content = {'summary': '有尝试承接案主的感受，可以继续核对理解。', 'suggestedStars': 4,
                       'findings': [{'turn': 1, 'quote': turns[0]['student'] if scenario != 'badquote' else '并不存在的原话', 'title': '尝试回应感受', 'kind': 'strength', 'note': '尝试回应案主表达中的担心，但还应核对具体含义。', 'suggestion': '可以邀请案主说一个具体例子。', 'sourceIds': ['empathy', 'clarifying']}], 'nextSteps': ['一次围绕一个重点提问。']}
        else:
            content = {'reply': '<img src=x onerror=alert(1)>我想先把自己的担心说清楚，也希望你能听听我在意的事情。'}
        payload = json.dumps({'choices': [{'finish_reason': 'stop', 'message': {'content': json.dumps(content, ensure_ascii=False)}}]}, ensure_ascii=False).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

mock = ThreadingHTTPServer(('127.0.0.1', 0), MockModel)
threading.Thread(target=mock.serve_forever, daemon=True).start()
with tempfile.TemporaryDirectory(prefix='casework-ai-ui-') as data:
    proc = None
    def start():
        global proc
        proc = subprocess.Popen(['node', 'server.js'], cwd=ROOT, env={**os.environ, 'ADMIN_PASSWORD': ADMIN_PASSWORD, 'PORT': '3032', 'DATA_DIR': data, 'NODE_ENV': 'test', 'AI_ENABLED': '1', 'AI_PROVIDER': 'deepseek', 'AI_MODEL': 'mock-model', 'MODEL_API_KEY': fixture_key, 'AI_BASE_URL': f'http://127.0.0.1:{mock.server_port}/v1'}, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        assert '3032' in proc.stdout.readline()
    def stop():
        if proc and proc.poll() is None:
            proc.terminate()
            proc.wait(timeout=10)
    try:
        start()
        fixture = setup_users('http://127.0.0.1:3032', 'AI测试')
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=shutil.which('chromium'), headless=True, args=['--no-sandbox'])
            tc = browser.new_context(viewport={'width': 1280, 'height': 900})
            sc = browser.new_context(viewport={'width': 390, 'height': 844})
            teacher, student = tc.new_page(), sc.new_page()
            errors = []
            for page in [teacher, student]: page.on('pageerror', lambda e: errors.append(str(e)))
            teacher.goto('http://127.0.0.1:3032')
            login_teacher(teacher, fixture)
            teacher.get_by_role('button', name='检查模型连接').click()
            teacher.get_by_role('heading', name='模型服务：连接检查通过').wait_for()
            student.goto('http://127.0.0.1:3032')
            register_student(student, fixture)
            student.get_by_role('button', name='开始一次实训').click()
            expect(student.locator('input[value="ai"]')).to_be_checked()
            assert student.locator('#ai-consent').is_visible()
            student.locator('#ai-consent').check()
            assert student.evaluate('document.documentElement.scrollWidth <= innerWidth')
            student.screenshot(path=str(OUT / 'ai-mode-mobile.png'), full_page=True)
            student.get_by_role('button', name='随机抽取案主').click()
            student.get_by_role('button', name='我准备好了，开始会谈').click()
            student.get_by_text('AI案主 · DeepSeek', exact=True).wait_for()
            message = '听起来，您既担心家人，也承受着自己的压力。我希望先理解您的感受，而不是急着告诉您该怎么办。我的理解准确吗？'
            for n in range(3):
                student.get_by_label('输入你的回应').fill(message)
                student.get_by_role('button', name='发送', exact=False).click()
                expect(student.locator('.message.student')).to_have_count(n + 1)
            assert student.locator('#messages img').count() == 0
            assert '<img src=x' in student.locator('#messages').inner_text()
            stop()
            file = Path(data) / 'db.json'
            db = json.loads(file.read_text()); db['sessions'][0]['startedAt'] = int(time.time() * 1000) - 181000
            file.write_text(json.dumps(db)); start()
            teacher.reload()
            teacher.get_by_role('heading', name='模型服务：连接检查通过').wait_for()
            teacher.get_by_role('button', name='检查模型连接').click()
            teacher.get_by_role('heading', name='模型服务：连接检查通过').wait_for()
            student.reload()
            student.get_by_role('button', name='全部记录').click()
            student.locator('button[data-session]').first.click()
            student.get_by_role('button', name='结束会谈，进入视频演练').click()
            scenario = 'badquote'
            student.get_by_role('button', name='生成AI文字反馈').click()
            student.get_by_text('AI反馈引用了不匹配的原话或教材编号，已拦截，请重试。', exact=True).wait_for()
            assert student.locator('.ai-summary').count() == 0
            scenario = 'valid'
            student.get_by_role('button', name='生成AI文字反馈').click()
            student.locator('.ai-summary').wait_for()
            expect(student.locator('.ai-rating')).to_contain_text('★★★★☆')
            assert student.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'AI review mobile overflow'
            student.screenshot(path=str(OUT / 'ai-review-mobile.png'), full_page=True)
            teacher.get_by_role('button', name='学生实训', exact=True).click()
            teacher.locator('button[data-session]').first.click()
            teacher.get_by_text('填写教师语言复核', exact=True).click()
            teacher.get_by_label('文字语言星级').select_option('3')
            teacher.get_by_label('复核依据', exact=True).fill('虽然回应了情绪，但对矛盾处境的探索还不充分。')
            teacher.get_by_role('button', name='保存语言复核').click()
            teacher.locator('.teacher-assessment').wait_for()
            expect(teacher.locator('.teacher-assessment')).to_contain_text('★★★☆☆')
            expect(teacher.locator('.ai-rating')).to_contain_text('★★★★☆')
            teacher.screenshot(path=str(OUT / 'ai-teacher-review.png'), full_page=True)
            assert not errors, errors
            print('AI browser fixture passed: teacher connection check, student consent, contextual requests, escaped model text, rejection of fake quotes, AI feedback, separate teacher assessment, mobile layout. No real model was called.')
            browser.close()
    finally:
        stop()
        mock.shutdown()
        mock.server_close()

"""Optional browser integration: Python playwright, Chromium and ffmpeg required.
Runs against an isolated temporary database; advances its clock fixture by restarting.
"""
import json
import sys
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'testing'))
from browser_helpers import ADMIN_PASSWORD, setup_users, register_student, login_teacher
OUT = Path('/tmp/casework-smoke')
OUT.mkdir(exist_ok=True)
video = OUT / 'practice.mp4'
subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x526e5b:s=320x240:r=1', '-t', '181', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-y', str(video)], check=True)

with tempfile.TemporaryDirectory(prefix='casework-browser-') as data:
    proc = None
    def start():
        global proc
        proc = subprocess.Popen(['node', 'server.js'], cwd=ROOT, env={**os.environ, 'ADMIN_PASSWORD': ADMIN_PASSWORD, 'PORT': '3031', 'DATA_DIR': data}, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        line = proc.stdout.readline()
        assert '3031' in line, line
    def stop():
        if proc and proc.poll() is None:
            proc.terminate()
            proc.wait(timeout=10)
    try:
        start()
        fixture = setup_users('http://127.0.0.1:3031', '测试')
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=shutil.which('chromium'), headless=True, args=['--no-sandbox'])
            page = browser.new_page(viewport={'width': 1440, 'height': 1000})
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto('http://127.0.0.1:3031')
            register_student(page, fixture)
            page.get_by_role('heading', name='你好，测试学生').wait_for()
            page.screenshot(path=str(OUT / 'desktop.png'), full_page=True)
            page.set_viewport_size({'width': 390, 'height': 844})
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Mobile page overflow'
            page.screenshot(path=str(OUT / 'mobile.png'), full_page=True)
            page.get_by_role('button', name='教学资料', exact=True).click()
            page.get_by_role('heading', name='让每一次回应，都有依据').wait_for()
            assert page.locator('.knowledge-card').count() == 10
            assert page.locator('.role-guide').count() == 0
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Mobile knowledge overflow'
            page.screenshot(path=str(OUT / 'learning-mobile.png'), full_page=True)
            page.get_by_role('button', name='学习概览', exact=False).click()
            page.set_viewport_size({'width': 1024, 'height': 768})
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'iPad page overflow'
            page.get_by_role('button', name='开始一次实训').click()
            page.locator('.offline-option summary').click()
            page.locator('input[value=rules]').check()
            page.get_by_role('button', name='随机抽取案主').click()
            page.get_by_role('button', name='我准备好了，开始会谈').click()
            page.get_by_label('输入你的回应').fill('听起来，你一方面担心家人，一方面也感到很累。我理解得对吗？')
            page.get_by_role('button', name='发送').click()
            page.get_by_text('我 · 实习社工', exact=True).wait_for()
            assert page.locator('#finish-chat').is_disabled(), 'Minimum interview duration not enforced'
            # Advance only the isolated test fixture, never the live app database.
            stop()
            dbpath = Path(data) / 'db.json'
            db = json.loads(dbpath.read_text())
            db['sessions'][0]['startedAt'] = int(time.time() * 1000) - 181000
            dbpath.write_text(json.dumps(db, ensure_ascii=False))
            start()
            page.reload()
            page.get_by_role('button', name='全部记录').click()
            page.get_by_role('button', name='继续', exact=False).click()
            page.get_by_role('button', name='结束会谈，进入视频演练').click()
            page.get_by_role('heading', name='文字会谈复盘').wait_for()
            assert page.locator('.evidence-pair').count() >= 1
            assert '第四章' in page.locator('.text-review').inner_text()
            page.locator('#video-file').set_input_files(str(video))
            page.wait_for_function('() => document.querySelector("#video-preview video")?.duration > 180')
            page.locator('#consent').check()
            page.get_by_role('button', name='上传视频，查看练习提示').click()
            page.get_by_role('heading', name='练习反馈', exact=True).wait_for()
            page.get_by_label('实训感受', exact=True).fill('我发现倾听需要耐心，也需要核对自己对案主情绪的理解。' * 15)
            page.get_by_role('button', name='提交，完成实训').click()
            page.get_by_role('heading', name='这一次练习，已认真完成').wait_for()
            page.screenshot(path=str(OUT / 'feedback.png'), full_page=True)
            page.locator('.source-link[data-learn="empathy"]').first.click()
            page.get_by_role('heading', name='让每一次回应，都有依据').wait_for()
            assert page.locator('#knowledge-empathy').is_visible()
            page.get_by_role('button', name='我的记录', exact=True).click()
            page.get_by_role('button', name='退出登录', exact=True).click()
            login_teacher(page, fixture)
            page.get_by_role('button', name='检查模型连接').wait_for()
            assert page.get_by_role('button', name='检查模型连接').is_enabled()
            page.get_by_role('button', name='检查模型连接').click()
            page.get_by_text('尚未启用模型服务，当前可继续使用规则演示。', exact=True).last.wait_for()
            assert page.get_by_role('button', name='检查模型连接').is_enabled()
            expect(page.locator('.config-checks')).to_contain_text('当前运行实例未读到')
            page.get_by_role('button', name='教学资料', exact=True).click()
            page.locator('.role-guide').first.wait_for()
            assert page.locator('.role-guide').count() == 5
            page.locator('.role-guide').filter(has_text='张叔').locator('summary').click()
            assert '本人失业' in page.locator('.role-guide[open]').inner_text()
            page.screenshot(path=str(OUT / 'learning-teacher.png'), full_page=True)
            page.get_by_role('button', name='学生实训', exact=True).click()
            page.locator('button[data-session]').first.click()
            page.get_by_label('教师点评', exact=True).fill('能够尝试回应案主感受，建议继续练习开放式提问。')
            page.get_by_role('button', name='保存点评').click()
            page.get_by_text('教师点评已保存', exact=True).wait_for()
            page.get_by_role('button', name='加载演练视频').click()
            page.wait_for_function('() => document.querySelector("#saved-video video")?.readyState >= 1')
            page.get_by_role('button', name='学生实训', exact=False).click()
            page.get_by_label('搜索学生').fill('测试学生')
            page.get_by_label('实训进度').select_option('completed')
            page.locator('button[data-session]').first.wait_for()
            with page.expect_download() as download:
                page.get_by_role('button', name='导出反馈').click()
            assert '测试学生' in Path(download.value.path()).read_text(encoding='utf-8-sig')
            assert not errors, errors
            print('Browser smoke passed: desktop/mobile/iPad, login, draw, timed chat, real video upload/playback, reflection, teacher note, filter, CSV, textbook knowledge, teacher role guides, cited evidence; no browser errors.')
            browser.close()
    finally:
        stop()

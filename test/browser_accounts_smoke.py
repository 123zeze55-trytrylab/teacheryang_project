"""Exercise account administration and recovery through real browser forms."""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from playwright.sync_api import sync_playwright, expect
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'testing'))
from browser_helpers import ADMIN_PASSWORD, PASSWORD, register_student
OUT = Path('/tmp/casework-smoke'); OUT.mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(prefix='casework-accounts-ui-') as data:
    proc = subprocess.Popen(['node','server.js'],cwd=ROOT,env={**os.environ,'PORT':'3033','DATA_DIR':data,'ADMIN_PASSWORD':ADMIN_PASSWORD},stdout=subprocess.PIPE,text=True)
    try:
        assert '3033' in proc.stdout.readline()
        with sync_playwright() as p:
            browser=p.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox'])
            admin=browser.new_page(viewport={'width':1440,'height':1000}); student=browser.new_page(viewport={'width':390,'height':844})
            errors=[]
            for page in [admin,student]: page.on('pageerror',lambda e: errors.append(str(e)))
            def login(page,role,username,password):
                page.get_by_role('button',name=role,exact=True).click()
                page.get_by_label('账号' if role!='学生' else '学号',exact=True).fill(username)
                page.get_by_label('密码',exact=True).fill(password)
                page.locator('#login-form button[type=submit]').click()
            def change(page,old,new):
                page.get_by_label('临时密码',exact=True).fill(old)
                page.get_by_label('新密码（至少10个字符）',exact=True).fill(new)
                page.get_by_label('确认新密码',exact=True).fill(new)
                page.get_by_role('button',name='保存新密码',exact=True).click()
            admin.goto('http://127.0.0.1:3033'); login(admin,'管理员','admin',ADMIN_PASSWORD)
            admin.get_by_role('button',name='账号与班级',exact=False).click()
            admin.get_by_label('用户名',exact=True).fill('teacher-ui')
            admin.locator('#staff-name').fill('界面教师')
            admin.get_by_label('初始密码（至少10字符）',exact=True).fill(PASSWORD)
            admin.get_by_role('button',name='创建账号',exact=True).click()
            admin.get_by_text('账号已创建，首次登录须修改初始密码',exact=True).wait_for()
            admin.get_by_role('button',name='退出登录',exact=True).click()
            login(admin,'教师','teacher-ui',PASSWORD); change(admin,PASSWORD,PASSWORD+'-Changed')
            admin.get_by_role('heading',name='教师工作台',exact=True).wait_for()
            admin.get_by_role('button',name='账号与班级',exact=False).click()
            admin.locator('#roster-input').fill('20260002 界面学生')
            admin.get_by_role('button',name='导入并生成注册码',exact=True).click()
            code=admin.locator('.invitation-results code').inner_text()
            admin.screenshot(path=str(OUT/'accounts-desktop.png'),full_page=True)
            student.goto('http://127.0.0.1:3033');register_student(student,{'studentId':'20260002','registrationCode':code,'password':PASSWORD})
            student.get_by_role('heading',name='你好，界面学生',exact=False).wait_for()
            assert student.evaluate('document.documentElement.scrollWidth <= innerWidth')
            admin.reload();admin.get_by_role('button',name='账号与班级',exact=False).click()
            admin.get_by_role('button',name='重置密码',exact=True).click()
            temporary=PASSWORD+'-Temporary'
            admin.get_by_label('临时密码（至少10字符）',exact=True).fill(temporary)
            admin.get_by_role('button',name='确认重置密码',exact=True).click()
            admin.get_by_text('密码已重置，旧登录已撤销',exact=True).wait_for()
            student.reload();student.locator('#login-form').wait_for()
            login(student,'学生','20260002',temporary)
            student.get_by_role('heading',name='请修改临时密码',exact=True).wait_for()
            student.screenshot(path=str(OUT/'password-mobile.png'),full_page=True)
            change(student,temporary,PASSWORD+'-StudentChanged')
            student.get_by_role('heading',name='你好，界面学生',exact=False).wait_for()
            student.reload();student.get_by_role('heading',name='你好，界面学生',exact=False).wait_for()
            assert not errors,errors
            print('Account browser passed: admin creates teacher, mandatory password change, teacher imports roster, student registers, reset revokes session, temporary-password change and cookie persistence; no browser errors.')
            browser.close()
    finally:
        proc.terminate();proc.wait(timeout=10)

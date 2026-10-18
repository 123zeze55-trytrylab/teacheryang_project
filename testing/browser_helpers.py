import json
import urllib.request

ADMIN_PASSWORD = 'Test-Admin-Private-2026'
PASSWORD = 'Test-Account-Private-2026'

def api(base, path, body, token=None):
    req = urllib.request.Request(base+'/api'+path, data=json.dumps(body).encode(), headers={'Content-Type':'application/json', **({'Authorization':'Bearer '+token} if token else {})})
    with urllib.request.urlopen(req) as res:
        return json.load(res)

def setup_users(base, prefix='测试'):
    admin = api(base, '/login', {'role':'admin','username':'admin','password':ADMIN_PASSWORD})['token']
    api(base, '/admin/users', {'role':'teacher','username':'teacher-test','name':prefix+'教师','password':PASSWORD,'classIds':['default']}, admin)
    teacher = api(base, '/login', {'role':'teacher','username':'teacher-test','password':PASSWORD})['token']
    api(base, '/change-password', {'oldPassword':PASSWORD,'newPassword':PASSWORD+'-Changed'}, teacher)
    invite = api(base, '/roster', {'classId':'default','students':[{'studentId':'20260001','name':prefix+'学生'}]}, admin)[0]
    return {**invite, 'password':PASSWORD, 'teacherPassword':PASSWORD+'-Changed'}

def register_student(page, fixture):
    page.get_by_role('button', name='首次使用？学生注册', exact=True).click()
    page.get_by_label('学号', exact=True).fill(fixture['studentId'])
    page.get_by_label('一次性注册码', exact=True).fill(fixture['registrationCode'])
    page.get_by_label('设置密码', exact=True).fill(fixture['password'])
    page.get_by_label('确认密码', exact=True).fill(fixture['password'])
    page.get_by_role('button', name='完成注册并登录', exact=False).click()

def login_teacher(page, fixture):
    page.get_by_role('button', name='教师', exact=True).click()
    page.get_by_label('账号', exact=True).fill('teacher-test')
    page.get_by_label('密码', exact=True).fill(fixture['teacherPassword'])
    page.get_by_role('button', name='登录', exact=False).filter(has_text='登录 →').click()

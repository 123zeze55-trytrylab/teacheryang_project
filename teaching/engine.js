import { cases } from './cases.js';
import { roleGuides } from './roles.js';
import { learningLibrary, references, teachingVersion } from './knowledge.js';
export { learningLibrary, roleGuides, teachingVersion };

const judgment = /(?:你|您)(?:就是|太|怎么这么)(?:懒惰|懒|笨|自私|矫情|没用|无能|差劲|糟糕|蠢)|都是你(?:的)?错|活该|别矫情|不争气|没出息/;
const coercion = /(?:你|您)(?:就)?(?:必须|一定得|只能)|按我说的做|听我的就行|不要再想了|别想那么多/;
const emotion = /担心|难过|失望|委屈|生气|气愤|孤单|孤独|不安|害怕|紧张|压力|很累|疲惫|矛盾|迷茫|混乱|不容易/;
const frame = /听起来|听到你|听到您|似乎|好像|感到|感受|一方面|既.*又/;
const check = /理解得?对吗|理解准确|是这样吗|对不对|贴近你的|贴近您的|有没有理解错|我说得对吗/;
const open = /可以(?:再|具体)?(?:说|讲)|愿意(?:再|具体)?(?:说|讲)|能(?:再|具体)?(?:说|讲)|(?:什么|哪些|怎样|怎么).*?[？?]|举个例子/;
const permission = /如果你愿意|如果您愿意|你愿意.*[？?]|您愿意.*[？?]|由你决定|由您决定|一起(?:想|讨论|商量)|你希望|您希望/;
const summarize = /总结一下|整理一下|刚才(?:我们|您|你)谈到|我们谈了|今天谈了|回顾一下/;
const absolutePrivacy = /(?:绝对|无论如何|永远|任何情况).{0,12}(?:保密|不告诉)|(?:任何人|谁).{0,6}(?:都不会|也不会)知道/;
const safety = /安全|再.{0,4}(?:动手|受伤)|现在.{0,8}(?:危险|安心)|伤口|康复|伤势|紧急/;
const isHarmful = text => judgment.test(text) || coercion.test(text);
const empathetic = text => /你|您/.test(text) && frame.test(text) && emotion.test(text) && !isHarmful(text);

export function replyToStudent({ caseId, text, messages = [] }) {
  const role = roleGuides[caseId];
  if (!role) throw new Error('Unknown case');
  const compact = text.replace(/\s/g, '');
  let branch, lines;
  if (isHarmful(compact)) { branch = 'guarded'; lines = role.guarded; }
  else if (safety.test(compact)) { branch = 'safety'; lines = [role.safety]; }
  else {
    const topic = role.topics.find(t => t.pattern.test(compact));
    if (topic) { branch = topic.id; lines = topic.lines; }
    else if (empathetic(compact) || check.test(compact)) { branch = 'empathy'; lines = role.empathic; }
    else if (summarize.test(compact)) { branch = 'summary'; lines = ['我想先确认你有没有理解我的意思。如果你愿意，可以把你听到的重点说给我听。']; }
    else { branch = 'explore'; lines = ['我还想把刚才那些感受说清楚，你想先了解哪一部分？', '有些事情我也还没想明白。能不能从我刚才提到的困扰，慢慢谈下去？']; }
  }
  const previous = messages.filter(m => m.role === 'client' && m.scriptBranch === branch).length;
  return { text: lines[previous % lines.length], scriptBranch: branch, engine: 'scripted-rules' };
}

export function buildTextReview(session) {
  const messages = session.messages || [];
  let number = 0;
  const turns = messages.flatMap((message, index) => {
    if (message.role !== 'student') return [];
    number++;
    const prior = messages.slice(0, index).reverse().find(m => m.role === 'client');
    return [{ turn: number, quote: message.text, clientQuote: prior?.text || '', text: message.text.replace(/\s/g, '') }];
  });
  const observations = [];
  function add(id, title, kind, predicate, note, action, sources) {
    const hits = turns.filter(t => predicate(t.text)).slice(0, 2);
    if (!hits.length) return;
    observations.push({ id, title, kind, note, action, evidence: hits.map(({ text, ...rest }) => rest), references: references(sources) });
  }
  add('judgment', '检查是否带有标签或责备', 'review', t => judgment.test(t),
    '检测到可能带有评价性的措辞。它也可能出现在引用或澄清中，需要结合前后文判断，不能据此认定学生在责备。',
    '回看这句话是在描述事实、复述案主，还是把问题归咎于对方；尝试改为询问具体经历和感受。', ['acceptance', 'listening']);
  add('coercion', '检查建议是否留有选择空间', 'review', t => coercion.test(t),
    '检测到“必须”等强制性表达的线索，需要教师核对其语境及合理性。',
    '先确认案主的需要，征询是否愿意讨论办法，再一起探索可行选择。', ['autonomy']);
  add('privacy', '检查是否作了绝对保密承诺', 'review', t => absolutePrivacy.test(t),
    '检测到可能无条件承诺保密的表述；规则无法判断是否只是引用，需人工复核。',
    '练习说明保密范围和例外，具体说明应遵循课程指导及机构规范。', ['confidentiality']);
  add('empathy', '发现尝试回应感受的表达', 'clue', empathetic,
    '检测到对案主的感受性表述。这只是表达线索，是否准确、是否贴近案主，需要对照前一句并由教师复核。',
    '核对感受来自案主已表达的经历，还是自己的猜测；给案主补充或纠正的机会。', ['empathy', 'listening']);
  add('clarifying', '发现邀请说明或核对理解的表达', 'clue', t => (open.test(t) || check.test(t)) && !isHarmful(t),
    '检测到开放探索或核对理解的措辞，不代表问题一定合适；核实事实时封闭式问题也可能有效。',
    '一次聚焦一个问题，并观察它是否承接了案主刚才最想表达的内容。', ['clarifying', 'focusing']);
  add('autonomy', '发现征询意愿的表达', 'clue', t => permission.test(t) && !isHarmful(t),
    '检测到邀请案主参与、商量或表达意愿的措辞，需要结合上下文确认是否真正留有选择空间。',
    '在提出建议前讨论案主的想法与顾虑，避免用征询式句子包装既定答案。', ['autonomy']);
  add('summary', '发现整理会谈的表达', 'clue', t => summarize.test(t) && !isHarmful(t),
    '检测到摘要或回顾的线索，未验证摘要是否完整准确，也未验证实际发生在结束阶段。',
    '简要串联经历和感受，再向案主核对有没有遗漏；结束时协商后续。', ['summary', 'stages']);
  const role = roleGuides[session.case?.id];
  const nextSteps = [];
  if (!observations.some(o => o.id === 'empathy')) nextSteps.push({ title: '试着回应感受', note: '规则未找到预设的感受表达模式，不代表你没有运用同感。请回看是否回应了案主的感受与处境。', references: references(['empathy']) });
  if (!observations.some(o => o.id === 'summary')) nextSteps.push({ title: '为会谈留一个收束', note: '规则未找到预设的摘要模式。可回看是否整理了重点、核对感受并协商下一步。', references: references(['summary', 'stages']) });
  if (['A', 'E'].includes(session.case?.id)) nextSteps.push({ title: '回看伤势与安全关怀', note: '本案例涉及受伤和家庭暴力。结合目标回看是否询问近期伤势与安全处境，尊重案主意愿；这不是自动安全评估。', references: references(['attending', 'autonomy', 'confidentiality']) });
  return {
    version: teachingVersion, mode: 'textbook-rules', generatedAt: Date.now(), score: null,
    notice: '教材章节转述支持的文字规则复盘，仅识别表达线索，不理解全部语义，不分析视频或声音，不自动评分；请结合语境由教师复核。',
    turnCount: turns.length, observations,
    nextSteps,
    example: role ? { text: role.example, followUp: role.nextQuestion, notice: '编写的练习示例，不是教材原文或唯一正确答案；仅在与案主当时表达相符时参考。', references: references(['empathy', 'clarifying']) } : null,
    goals: (session.case?.goals || []).map(goal => ({ text: goal, status: '请结合会谈记录自行回看，不自动判断是否达成' })),
    reflectionPrompts: ['哪一句回应最接近案主当时的感受？请举出会谈中的原话。', '有没有一次提问或建议来得太早？你会怎样调整？', '如果再谈一次，你会怎样核对理解并结束这次会谈？'],
  };
}

export function teacherRoles() {
  return cases.map(c => {
    const r = roleGuides[c.id];
    return { id: c.id, name: c.name, stage: r.stage, focus: r.focus, knownFacts: r.knownFacts, boundaries: r.boundaries, topics: r.topics.map(t => t.label), emotions: r.emotions,
      references: references(c.id === 'C' ? ['stages', 'empathy', 'clarifying'] : ['stages', 'listening', 'autonomy']),
      notice: '背景来自需求文档；情绪主题和对话分支为编写的虚构教学设定，非教材原案例，也不是对真实人群的心理判断。' };
  });
}

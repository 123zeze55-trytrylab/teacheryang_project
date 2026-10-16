// Teaching paraphrases, not textbook quotations. Keep uploaded source documents outside Git.
export const teachingVersion = 'textbook-rules-1';
export const book = {
  title: '个案工作', edition: '第2版', editor: '许莉娅', publisher: '高等教育出版社', year: 2013,
  isbn: '978-7-04-036590-0',
  notice: '以下内容为依据所提供教材相关章节整理的教学转述，非教材原文；章节定位已核对，教学适配尚待课程教师审阅。',
};
const communication = '第四章 第一节 个案工作沟通 · 个案会谈';
const values = '第二章 第三节 社会工作的核心价值原则及其在个案工作中的应用';
export const knowledge = [
  { id: 'attending', title: '表达专注', category: '支持性技巧', source: `${communication} · 支持性技巧：表达专注`,
    principle: '通过自然、开放的姿态和适当的目光关注，让案主感到有人陪伴。关注需要与当时的谈话情境相适应。',
    practice: '练习时留意自己是否急于打断、持续看向别处或显得不耐烦；不要求一直微笑。',
    limitation: '仅凭目光或表情不能判断一个人的诚实程度、内心情绪或专业能力。' },
  { id: 'listening', title: '主动倾听', category: '支持性技巧', source: `${communication} · 支持性技巧：主动倾听`,
    principle: '同时留意案主讲述的经历、行为和感受，暂缓自己的判断，先弄清对方想表达什么。',
    practice: '在提问前回看：我是否听到了具体发生的事，也听到了这件事对案主的意义？',
    limitation: '文字规则只能找到表达线索，不能证明已经充分倾听。' },
  { id: 'empathy', title: '同理与同感回应', category: '支持性技巧', source: `${communication} · 支持性技巧：同理心；第五章 第二节 · 同感`,
    principle: '从案主的处境理解其感受与看法，并以恰当、及时的表达把理解传达回去，给对方修正的空间。',
    practice: '结合案主刚说过的内容，用试探和核对的语气回应感受；不要只套用“我理解你”。',
    limitation: '回应深入不等于擅自猜测。语言五星量表来自需求方，不是教材自带的自动评分标准。' },
  { id: 'clarifying', title: '澄清与开放式提问', category: '引领性技巧', source: `${communication} · 引领性技巧：澄清`,
    principle: '对模糊的经历或表述邀请进一步说明，让双方逐步获得具体、共同的理解。',
    practice: '一次围绕一个重点，请案主举例或多说一点；核实事实时也可以适当用封闭式问题。',
    limitation: '问题形式不是质量的全部，不能把所有封闭式问题都判为不好。' },
  { id: 'focusing', title: '对焦', category: '引领性技巧', source: `${communication} · 引领性技巧：对焦`,
    principle: '在多个话题间协商出当前的重点，使会谈围绕案主需要和本次目标展开。',
    practice: '先承认有多重困难，再询问案主希望从哪一件开始，而不是强行更换话题。',
    limitation: '本次目标是引导方向，不应成为打断案主的理由。' },
  { id: 'summary', title: '摘要与核对', category: '引领性技巧', source: `${communication} · 引领性技巧：摘要`,
    principle: '把谈到的事情和感受简明串联起来，向案主核对理解，允许对方补充或纠正。',
    practice: '结束前整理这次谈话的重点，问一问还有什么被遗漏，而不是逐字重复全部内容。',
    limitation: '有“总结一下”等字样不代表摘要准确，需要回到前文核对。' },
  { id: 'acceptance', title: '接纳与非评判', category: '价值与伦理', source: `${values} · 接纳与非评判`,
    principle: '尊重案主的人格与处境，理解其感受，避免用个人好恶给对方贴标签。',
    practice: '区分对人的尊重与对具体行为的讨论，用探索性的语言替代责备。',
    limitation: '接纳不意味着认同伤害行为，也不应忽略现实安全问题。' },
  { id: 'autonomy', title: '案主自决与协商建议', category: '价值与伦理', source: `${values} · 服务对象自决；${communication} · 影响性技巧：建议`,
    principle: '帮助案主理解选择及可用资源，讨论建议的可行性，把决定空间留给案主。',
    practice: '先理解处境，再征询是否愿意一起讨论办法；不要要求案主必须照办。',
    limitation: '自决有边界，涉及现实危险等情形需要遵循专业伦理、机构流程及适用规范。' },
  { id: 'confidentiality', title: '保密与专业边界', category: '价值与伦理', source: `${values} · 保密原则；第二章 第四节 社会工作专业伦理`,
    principle: '说明资料用途、保密范围及可能的例外，避免作出无条件、绝对保密的承诺。',
    practice: '练习介绍关系和记录安排，遇到安全疑虑时请教师指导，不能把演示平台当作实际个案服务。',
    limitation: '具体的保密例外与处置程序应由教师结合当地规范确认。' },
  { id: 'stages', title: '会谈开始、发展与结束', category: '会谈结构', source: `${communication} · 个案会谈的过程；第六章 第一节 接案与建立关系`,
    principle: '开始时建立联系并明确目的，发展时围绕需要探索，结束时处理情绪、整理重点并协商后续。',
    practice: '首次会谈关注关系和角色说明；后续面谈可先关心上次之后的变化；探访也要尊重对方意愿。',
    limitation: '本平台的3—5分钟是课程微练习设置，不是教材对真实完整会谈时长的要求。' },
];
export const languageRubric = {
  source: '需求文档：语言评分标准（需求方提供，非教材原文）',
  notice: '作为教师复核和学生自查的参照；当前规则系统不自动给星级，也不计总分或排名。',
  levels: [
    { stars: 1, description: '未回应案主表达的感受与主要信息。' },
    { stars: 2, description: '主要复述表面内容，对感受的理解和回应较少。' },
    { stars: 3, description: '回应与案主明确表达的内容和感受基本一致。' },
    { stars: 4, description: '在准确理解的基础上，尝试回应话语背后尚未充分表达的感受。' },
    { stars: 5, description: '较全面、准确地回应表面感受与深层矛盾，并允许案主核对或纠正。' },
  ],
};
export const learningLibrary = { version: teachingVersion, book, cards: knowledge, languageRubric };
export function references(ids) {
  return [...new Set(ids)].map(id => {
    const card = knowledge.find(k => k.id === id);
    if (!card) throw new Error(`Unknown teaching reference: ${id}`);
    return { id, title: card.title, source: card.source };
  });
}

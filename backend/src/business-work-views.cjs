'use strict';
const {assert}=require('./business-common.cjs');
const profiles={
 superadmin:{label:'平台管理',title:'平台管理工作台',description:'查看平台运行、授权范围内的经营情况与待审批事项。'},
 principal:{label:'校区经营',title:'校长工作台',description:'关注授权校区的经营情况、线索分配和教务审批。'},
 academic:{label:'教务',title:'教务工作台',description:'处理排课、报名、调课、补课和考勤。'},
 sales:{label:'销售',title:'销售工作台',description:'跟进本人线索，安排试听、办理报名并跟进收款。'},
 finance:{label:'财务',title:'财务工作台',description:'核对待收款订单，核准退款并确认实际线下退款。'},
 teacher:{label:'教学',title:'教师工作台',description:'查看本人课次与学生，登记考勤和授课记录。'},
 operations:{label:'运营',title:'运营工作台',description:'管理获客活动、表单、提交审核和商城内容。'},
 auditor:{label:'只读审计',title:'审计工作台',description:'只读查看授权范围的业务资料、报表和业务操作。',readOnly:true}
};
function available(actor){return [...new Set(actor.roleIds||[])].filter(id=>profiles[id]).map(id=>({id,...profiles[id]}));}
function select(actor,requested){const views=available(actor);assert(views.length,'当前账号没有可用的岗位工作台','FORBIDDEN',403);const id=requested===undefined||requested===null?((actor.roleIds||[]).includes('superadmin')?'superadmin':views[0].id):requested;assert(typeof id==='string'&&views.some(v=>v.id===id),'当前账号没有此岗位工作台','FORBIDDEN',403);return {view:views.find(v=>v.id===id),views};}
module.exports={available,select,profiles};

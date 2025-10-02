// Sequelize 模型关联定义
import User from './User';
import Contact from './Contact';
import Group from './Group';
import GroupMember from './GroupMember';
// 注意：Message 是 Mongoose 模型，不是 Sequelize 模型，所以不包含在这里

// 定义 Sequelize 模型之间的关联关系

// User 和 Contact 的关联
User.hasMany(Contact, {
  foreignKey: 'userId',
  as: 'contacts'
});

User.hasMany(Contact, {
  foreignKey: 'contactId',
  as: 'contactOf'
});

Contact.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user'
});

Contact.belongsTo(User, {
  foreignKey: 'contactId',
  as: 'contact'
});

// User 和 Group 的关联
User.hasMany(Group, {
  foreignKey: 'owner_id',
  as: 'ownedGroups'
});

Group.belongsTo(User, {
  foreignKey: 'owner_id',
  as: 'owner'
});

// User 和 GroupMember 的关联
User.hasMany(GroupMember, {
  foreignKey: 'user_id',
  as: 'groupMemberships'
});

GroupMember.belongsTo(User, {
  foreignKey: 'user_id',
  as: 'user'
});

// Group 和 GroupMember 的关联
Group.hasMany(GroupMember, {
  foreignKey: 'group_id',
  as: 'members'
});

GroupMember.belongsTo(Group, {
  foreignKey: 'group_id',
  as: 'group'
});

// 多对多关联：User 通过 GroupMember 与 Group 关联
User.belongsToMany(Group, {
  through: GroupMember,
  foreignKey: 'user_id',
  otherKey: 'group_id',
  as: 'groups'
});

Group.belongsToMany(User, {
  through: GroupMember,
  foreignKey: 'group_id',
  otherKey: 'user_id',
  as: 'users'
});

console.log('✅ Sequelize 模型关联已配置');

export {
  User,
  Contact,
  Group,
  GroupMember
};

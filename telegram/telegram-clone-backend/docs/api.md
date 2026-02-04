# Telegram Clone API (Group Chat Focus)

This document describes the group-chat related API surface and the sync fields used by the client.

## Authentication

All routes below require `Authorization: Bearer <accessToken>`.

---

## Messages

### Search Messages
`GET /api/messages/search?q=<keyword>&targetId=<userId|groupId>&limit=50`

- If `targetId` is a groupId and the user is a member, server searches that group.
- If `targetId` is a userId, server searches the private chat.

Response:
```
{
  "messages": [
    {
      "id": "msgId",
      "chatId": "g:<groupId> | p:<userIdA>:<userIdB>",
      "chatType": "group | private",
      "seq": 120,
      "content": "hello",
      "senderId": "userId",
      "senderUsername": "alice",
      "groupId": "groupId",
      "timestamp": "2026-01-30T10:00:00.000Z",
      "type": "text",
      "status": "delivered",
      "isGroupChat": true,
      "attachments": []
    }
  ],
  "total": 1
}
```

Notes:
- `chatType` is the preferred field; `isGroupChat` is kept for compatibility during migration.

### Message Context
`GET /api/messages/context?chatId=<chatId>&seq=<seq>&limit=30`

Returns messages around the anchor `seq` for context jump.

Response:
```
{
  "chatId": "g:<groupId>",
  "seq": 120,
  "messages": [ ... ],
  "hasMoreBefore": true,
  "hasMoreAfter": false
}
```

### Mark Chat Read
`POST /api/messages/chat/:chatId/read`

Body:
```
{ "seq": 120 }
```

---

## Groups

### List My Groups (with lastMessage + unread)
`GET /api/groups/my`

Response:
```
{
  "groups": [
    {
      "id": "groupId",
      "name": "Project A",
      "memberCount": 12,
      "memberRole": "admin",
      "joinedAt": "2026-01-30T10:00:00.000Z",
      "unreadCount": 5,
      "lastMessage": {
        "id": "msgId",
        "content": "latest message",
        "timestamp": "2026-01-30T11:00:00.000Z",
        "senderId": "userId",
        "senderUsername": "alice",
        "type": "text"
      }
    }
  ],
  "total": 1
}
```

### Get Group Details
`GET /api/groups/:groupId`

Response:
```
{
  "group": {
    "id": "groupId",
    "name": "Project A",
    "ownerId": "userId",
    "currentUserRole": "admin",
    "currentUserStatus": "active"
  },
  "members": [
    {
      "id": "memberRowId",
      "userId": "userId",
      "role": "member",
      "status": "muted",
      "mutedUntil": "2026-01-30T12:00:00.000Z",
      "user": { "id": "userId", "username": "alice", "avatarUrl": "" }
    }
  ],
  "memberCount": 12
}
```

### Member Management

- Add members: `POST /api/groups/:groupId/members`
- Remove member: `DELETE /api/groups/:groupId/members/:memberId`
- Mute member: `POST /api/groups/:groupId/members/:memberId/mute`
- Unmute member: `POST /api/groups/:groupId/members/:memberId/unmute`
- Promote member: `POST /api/groups/:groupId/members/:memberId/promote`
- Demote member: `POST /api/groups/:groupId/members/:memberId/demote`
- Transfer ownership: `PUT /api/groups/:groupId/transfer-ownership`

---

## UpdateLog (Mongo)

Group member changes emit update logs:

```
{
  "type": "member_change",
  "chatId": "g:<groupId>",
  "payload": {
    "action": "member_added | member_removed | member_left | member_muted | member_unmuted | member_promoted | member_demoted | group_updated | ownership_transferred | group_deleted",
    "groupId": "<groupId>",
    "actorId": "<userId>",
    "targetId": "<userId>"
  }
}
```

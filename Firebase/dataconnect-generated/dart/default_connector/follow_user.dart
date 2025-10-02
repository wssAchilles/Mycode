part of 'default.dart';

class FollowUserVariablesBuilder {
  String followingId;

  final FirebaseDataConnect _dataConnect;
  FollowUserVariablesBuilder(this._dataConnect, {required  this.followingId,});
  Deserializer<FollowUserData> dataDeserializer = (dynamic json)  => FollowUserData.fromJson(jsonDecode(json));
  Serializer<FollowUserVariables> varsSerializer = (FollowUserVariables vars) => jsonEncode(vars.toJson());
  Future<OperationResult<FollowUserData, FollowUserVariables>> execute() {
    return ref().execute();
  }

  MutationRef<FollowUserData, FollowUserVariables> ref() {
    FollowUserVariables vars= FollowUserVariables(followingId: followingId,);
    return _dataConnect.mutation("FollowUser", dataDeserializer, varsSerializer, vars);
  }
}

class FollowUserFollowInsert {
  String followerId;
  String followingId;
  FollowUserFollowInsert.fromJson(dynamic json):
  
  followerId = nativeFromJson<String>(json['followerId']),
  followingId = nativeFromJson<String>(json['followingId']);

  Map<String, dynamic> toJson() {
    Map<String, dynamic> json = {};
    json['followerId'] = nativeToJson<String>(followerId);
    json['followingId'] = nativeToJson<String>(followingId);
    return json;
  }

  FollowUserFollowInsert({
    required this.followerId,
    required this.followingId,
  });
}

class FollowUserData {
  FollowUserFollowInsert follow_insert;
  FollowUserData.fromJson(dynamic json):
  
  follow_insert = FollowUserFollowInsert.fromJson(json['follow_insert']);

  Map<String, dynamic> toJson() {
    Map<String, dynamic> json = {};
    json['follow_insert'] = follow_insert.toJson();
    return json;
  }

  FollowUserData({
    required this.follow_insert,
  });
}

class FollowUserVariables {
  String followingId;
  @Deprecated('fromJson is deprecated for Variable classes as they are no longer required for deserialization.')
  FollowUserVariables.fromJson(Map<String, dynamic> json):
  
  followingId = nativeFromJson<String>(json['followingId']);

  Map<String, dynamic> toJson() {
    Map<String, dynamic> json = {};
    json['followingId'] = nativeToJson<String>(followingId);
    return json;
  }

  FollowUserVariables({
    required this.followingId,
  });
}


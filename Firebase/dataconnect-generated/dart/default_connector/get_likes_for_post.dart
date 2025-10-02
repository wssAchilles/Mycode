part of 'default.dart';

class GetLikesForPostVariablesBuilder {
  String postId;

  final FirebaseDataConnect _dataConnect;
  GetLikesForPostVariablesBuilder(this._dataConnect, {required  this.postId,});
  Deserializer<GetLikesForPostData> dataDeserializer = (dynamic json)  => GetLikesForPostData.fromJson(jsonDecode(json));
  Serializer<GetLikesForPostVariables> varsSerializer = (GetLikesForPostVariables vars) => jsonEncode(vars.toJson());
  Future<QueryResult<GetLikesForPostData, GetLikesForPostVariables>> execute() {
    return ref().execute();
  }

  QueryRef<GetLikesForPostData, GetLikesForPostVariables> ref() {
    GetLikesForPostVariables vars= GetLikesForPostVariables(postId: postId,);
    return _dataConnect.query("GetLikesForPost", dataDeserializer, varsSerializer, vars);
  }
}

class GetLikesForPostLikes {
  GetLikesForPostLikesUser user;
  GetLikesForPostLikes.fromJson(dynamic json):
  
  user = GetLikesForPostLikesUser.fromJson(json['user']);

  Map<String, dynamic> toJson() {
    Map<String, dynamic> json = {};
    json['user'] = user.toJson();
    return json;
  }

  GetLikesForPostLikes({
    required this.user,
  });
}

class GetLikesForPostLikesUser {
  String id;
  String username;
  GetLikesForPostLikesUser.fromJson(dynamic json):
  
  id = nativeFromJson<String>(json['id']),
  username = nativeFromJson<String>(json['username']);

  Map<String, dynamic> toJson() {
    Map<String, dynamic> json = {};
    json['id'] = nativeToJson<String>(id);
    json['username'] = nativeToJson<String>(username);
    return json;
  }

  GetLikesForPostLikesUser({
    required this.id,
    required this.username,
  });
}

class GetLikesForPostData {
  List<GetLikesForPostLikes> likes;
  GetLikesForPostData.fromJson(dynamic json):
  
  likes = (json['likes'] as List<dynamic>)
        .map((e) => GetLikesForPostLikes.fromJson(e))
        .toList();

  Map<String, dynamic> toJson() {
    Map<String, dynamic> json = {};
    json['likes'] = likes.map((e) => e.toJson()).toList();
    return json;
  }

  GetLikesForPostData({
    required this.likes,
  });
}

class GetLikesForPostVariables {
  String postId;
  @Deprecated('fromJson is deprecated for Variable classes as they are no longer required for deserialization.')
  GetLikesForPostVariables.fromJson(Map<String, dynamic> json):
  
  postId = nativeFromJson<String>(json['postId']);

  Map<String, dynamic> toJson() {
    Map<String, dynamic> json = {};
    json['postId'] = nativeToJson<String>(postId);
    return json;
  }

  GetLikesForPostVariables({
    required this.postId,
  });
}


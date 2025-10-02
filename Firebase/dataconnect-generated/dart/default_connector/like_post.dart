part of 'default.dart';

class LikePostVariablesBuilder {
  String postId;

  final FirebaseDataConnect _dataConnect;
  LikePostVariablesBuilder(this._dataConnect, {required  this.postId,});
  Deserializer<LikePostData> dataDeserializer = (dynamic json)  => LikePostData.fromJson(jsonDecode(json));
  Serializer<LikePostVariables> varsSerializer = (LikePostVariables vars) => jsonEncode(vars.toJson());
  Future<OperationResult<LikePostData, LikePostVariables>> execute() {
    return ref().execute();
  }

  MutationRef<LikePostData, LikePostVariables> ref() {
    LikePostVariables vars= LikePostVariables(postId: postId,);
    return _dataConnect.mutation("LikePost", dataDeserializer, varsSerializer, vars);
  }
}

class LikePostLikeInsert {
  String userId;
  String postId;
  LikePostLikeInsert.fromJson(dynamic json):
  
  userId = nativeFromJson<String>(json['userId']),
  postId = nativeFromJson<String>(json['postId']);

  Map<String, dynamic> toJson() {
    Map<String, dynamic> json = {};
    json['userId'] = nativeToJson<String>(userId);
    json['postId'] = nativeToJson<String>(postId);
    return json;
  }

  LikePostLikeInsert({
    required this.userId,
    required this.postId,
  });
}

class LikePostData {
  LikePostLikeInsert like_insert;
  LikePostData.fromJson(dynamic json):
  
  like_insert = LikePostLikeInsert.fromJson(json['like_insert']);

  Map<String, dynamic> toJson() {
    Map<String, dynamic> json = {};
    json['like_insert'] = like_insert.toJson();
    return json;
  }

  LikePostData({
    required this.like_insert,
  });
}

class LikePostVariables {
  String postId;
  @Deprecated('fromJson is deprecated for Variable classes as they are no longer required for deserialization.')
  LikePostVariables.fromJson(Map<String, dynamic> json):
  
  postId = nativeFromJson<String>(json['postId']);

  Map<String, dynamic> toJson() {
    Map<String, dynamic> json = {};
    json['postId'] = nativeToJson<String>(postId);
    return json;
  }

  LikePostVariables({
    required this.postId,
  });
}


part of 'default.dart';

class CreateCommentVariablesBuilder {
  String postId;
  String text;

  final FirebaseDataConnect _dataConnect;
  CreateCommentVariablesBuilder(this._dataConnect, {required  this.postId,required  this.text,});
  Deserializer<CreateCommentData> dataDeserializer = (dynamic json)  => CreateCommentData.fromJson(jsonDecode(json));
  Serializer<CreateCommentVariables> varsSerializer = (CreateCommentVariables vars) => jsonEncode(vars.toJson());
  Future<OperationResult<CreateCommentData, CreateCommentVariables>> execute() {
    return ref().execute();
  }

  MutationRef<CreateCommentData, CreateCommentVariables> ref() {
    CreateCommentVariables vars= CreateCommentVariables(postId: postId,text: text,);
    return _dataConnect.mutation("CreateComment", dataDeserializer, varsSerializer, vars);
  }
}

class CreateCommentCommentInsert {
  String id;
  CreateCommentCommentInsert.fromJson(dynamic json):
  
  id = nativeFromJson<String>(json['id']);

  Map<String, dynamic> toJson() {
    Map<String, dynamic> json = {};
    json['id'] = nativeToJson<String>(id);
    return json;
  }

  CreateCommentCommentInsert({
    required this.id,
  });
}

class CreateCommentData {
  CreateCommentCommentInsert comment_insert;
  CreateCommentData.fromJson(dynamic json):
  
  comment_insert = CreateCommentCommentInsert.fromJson(json['comment_insert']);

  Map<String, dynamic> toJson() {
    Map<String, dynamic> json = {};
    json['comment_insert'] = comment_insert.toJson();
    return json;
  }

  CreateCommentData({
    required this.comment_insert,
  });
}

class CreateCommentVariables {
  String postId;
  String text;
  @Deprecated('fromJson is deprecated for Variable classes as they are no longer required for deserialization.')
  CreateCommentVariables.fromJson(Map<String, dynamic> json):
  
  postId = nativeFromJson<String>(json['postId']),
  text = nativeFromJson<String>(json['text']);

  Map<String, dynamic> toJson() {
    Map<String, dynamic> json = {};
    json['postId'] = nativeToJson<String>(postId);
    json['text'] = nativeToJson<String>(text);
    return json;
  }

  CreateCommentVariables({
    required this.postId,
    required this.text,
  });
}


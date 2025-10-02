part of 'default.dart';

class CreatePostVariablesBuilder {
  
  final FirebaseDataConnect _dataConnect;
  CreatePostVariablesBuilder(this._dataConnect, );
  Deserializer<CreatePostData> dataDeserializer = (dynamic json)  => CreatePostData.fromJson(jsonDecode(json));
  
  Future<OperationResult<CreatePostData, void>> execute() {
    return ref().execute();
  }

  MutationRef<CreatePostData, void> ref() {
    
    return _dataConnect.mutation("CreatePost", dataDeserializer, emptySerializer, null);
  }
}

class CreatePostPostInsert {
  String id;
  CreatePostPostInsert.fromJson(dynamic json):
  
  id = nativeFromJson<String>(json['id']);

  Map<String, dynamic> toJson() {
    Map<String, dynamic> json = {};
    json['id'] = nativeToJson<String>(id);
    return json;
  }

  CreatePostPostInsert({
    required this.id,
  });
}

class CreatePostData {
  CreatePostPostInsert post_insert;
  CreatePostData.fromJson(dynamic json):
  
  post_insert = CreatePostPostInsert.fromJson(json['post_insert']);

  Map<String, dynamic> toJson() {
    Map<String, dynamic> json = {};
    json['post_insert'] = post_insert.toJson();
    return json;
  }

  CreatePostData({
    required this.post_insert,
  });
}


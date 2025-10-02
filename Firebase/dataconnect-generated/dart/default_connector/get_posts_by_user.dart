part of 'default.dart';

class GetPostsByUserVariablesBuilder {
  
  final FirebaseDataConnect _dataConnect;
  GetPostsByUserVariablesBuilder(this._dataConnect, );
  Deserializer<GetPostsByUserData> dataDeserializer = (dynamic json)  => GetPostsByUserData.fromJson(jsonDecode(json));
  
  Future<QueryResult<GetPostsByUserData, void>> execute() {
    return ref().execute();
  }

  QueryRef<GetPostsByUserData, void> ref() {
    
    return _dataConnect.query("GetPostsByUser", dataDeserializer, emptySerializer, null);
  }
}

class GetPostsByUserPosts {
  String id;
  String content;
  Timestamp createdAt;
  GetPostsByUserPosts.fromJson(dynamic json):
  
  id = nativeFromJson<String>(json['id']),
  content = nativeFromJson<String>(json['content']),
  createdAt = Timestamp.fromJson(json['createdAt']);

  Map<String, dynamic> toJson() {
    Map<String, dynamic> json = {};
    json['id'] = nativeToJson<String>(id);
    json['content'] = nativeToJson<String>(content);
    json['createdAt'] = createdAt.toJson();
    return json;
  }

  GetPostsByUserPosts({
    required this.id,
    required this.content,
    required this.createdAt,
  });
}

class GetPostsByUserData {
  List<GetPostsByUserPosts> posts;
  GetPostsByUserData.fromJson(dynamic json):
  
  posts = (json['posts'] as List<dynamic>)
        .map((e) => GetPostsByUserPosts.fromJson(e))
        .toList();

  Map<String, dynamic> toJson() {
    Map<String, dynamic> json = {};
    json['posts'] = posts.map((e) => e.toJson()).toList();
    return json;
  }

  GetPostsByUserData({
    required this.posts,
  });
}


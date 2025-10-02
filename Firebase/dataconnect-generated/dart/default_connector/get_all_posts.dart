part of 'default.dart';

class GetAllPostsVariablesBuilder {
  
  final FirebaseDataConnect _dataConnect;
  GetAllPostsVariablesBuilder(this._dataConnect, );
  Deserializer<GetAllPostsData> dataDeserializer = (dynamic json)  => GetAllPostsData.fromJson(jsonDecode(json));
  
  Future<QueryResult<GetAllPostsData, void>> execute() {
    return ref().execute();
  }

  QueryRef<GetAllPostsData, void> ref() {
    
    return _dataConnect.query("GetAllPosts", dataDeserializer, emptySerializer, null);
  }
}

class GetAllPostsPosts {
  String id;
  String content;
  String postType;
  Timestamp createdAt;
  String? mediaUrl;
  String? caption;
  GetAllPostsPostsAuthor author;
  GetAllPostsPosts.fromJson(dynamic json):
  
  id = nativeFromJson<String>(json['id']),
  content = nativeFromJson<String>(json['content']),
  postType = nativeFromJson<String>(json['postType']),
  createdAt = Timestamp.fromJson(json['createdAt']),
  mediaUrl = json['mediaUrl'] == null ? null : nativeFromJson<String>(json['mediaUrl']),
  caption = json['caption'] == null ? null : nativeFromJson<String>(json['caption']),
  author = GetAllPostsPostsAuthor.fromJson(json['author']);

  Map<String, dynamic> toJson() {
    Map<String, dynamic> json = {};
    json['id'] = nativeToJson<String>(id);
    json['content'] = nativeToJson<String>(content);
    json['postType'] = nativeToJson<String>(postType);
    json['createdAt'] = createdAt.toJson();
    if (mediaUrl != null) {
      json['mediaUrl'] = nativeToJson<String?>(mediaUrl);
    }
    if (caption != null) {
      json['caption'] = nativeToJson<String?>(caption);
    }
    json['author'] = author.toJson();
    return json;
  }

  GetAllPostsPosts({
    required this.id,
    required this.content,
    required this.postType,
    required this.createdAt,
    this.mediaUrl,
    this.caption,
    required this.author,
  });
}

class GetAllPostsPostsAuthor {
  String id;
  String username;
  String? displayName;
  String? profilePictureUrl;
  GetAllPostsPostsAuthor.fromJson(dynamic json):
  
  id = nativeFromJson<String>(json['id']),
  username = nativeFromJson<String>(json['username']),
  displayName = json['displayName'] == null ? null : nativeFromJson<String>(json['displayName']),
  profilePictureUrl = json['profilePictureUrl'] == null ? null : nativeFromJson<String>(json['profilePictureUrl']);

  Map<String, dynamic> toJson() {
    Map<String, dynamic> json = {};
    json['id'] = nativeToJson<String>(id);
    json['username'] = nativeToJson<String>(username);
    if (displayName != null) {
      json['displayName'] = nativeToJson<String?>(displayName);
    }
    if (profilePictureUrl != null) {
      json['profilePictureUrl'] = nativeToJson<String?>(profilePictureUrl);
    }
    return json;
  }

  GetAllPostsPostsAuthor({
    required this.id,
    required this.username,
    this.displayName,
    this.profilePictureUrl,
  });
}

class GetAllPostsData {
  List<GetAllPostsPosts> posts;
  GetAllPostsData.fromJson(dynamic json):
  
  posts = (json['posts'] as List<dynamic>)
        .map((e) => GetAllPostsPosts.fromJson(e))
        .toList();

  Map<String, dynamic> toJson() {
    Map<String, dynamic> json = {};
    json['posts'] = posts.map((e) => e.toJson()).toList();
    return json;
  }

  GetAllPostsData({
    required this.posts,
  });
}


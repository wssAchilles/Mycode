part of 'default.dart';

class GetPostCommentsVariablesBuilder {
  String postId;

  final FirebaseDataConnect _dataConnect;
  GetPostCommentsVariablesBuilder(this._dataConnect, {required  this.postId,});
  Deserializer<GetPostCommentsData> dataDeserializer = (dynamic json)  => GetPostCommentsData.fromJson(jsonDecode(json));
  Serializer<GetPostCommentsVariables> varsSerializer = (GetPostCommentsVariables vars) => jsonEncode(vars.toJson());
  Future<QueryResult<GetPostCommentsData, GetPostCommentsVariables>> execute() {
    return ref().execute();
  }

  QueryRef<GetPostCommentsData, GetPostCommentsVariables> ref() {
    GetPostCommentsVariables vars= GetPostCommentsVariables(postId: postId,);
    return _dataConnect.query("GetPostComments", dataDeserializer, varsSerializer, vars);
  }
}

class GetPostCommentsComments {
  String id;
  String text;
  Timestamp createdAt;
  GetPostCommentsCommentsAuthor author;
  GetPostCommentsComments.fromJson(dynamic json):
  
  id = nativeFromJson<String>(json['id']),
  text = nativeFromJson<String>(json['text']),
  createdAt = Timestamp.fromJson(json['createdAt']),
  author = GetPostCommentsCommentsAuthor.fromJson(json['author']);

  Map<String, dynamic> toJson() {
    Map<String, dynamic> json = {};
    json['id'] = nativeToJson<String>(id);
    json['text'] = nativeToJson<String>(text);
    json['createdAt'] = createdAt.toJson();
    json['author'] = author.toJson();
    return json;
  }

  GetPostCommentsComments({
    required this.id,
    required this.text,
    required this.createdAt,
    required this.author,
  });
}

class GetPostCommentsCommentsAuthor {
  String id;
  String username;
  String? displayName;
  String? profilePictureUrl;
  GetPostCommentsCommentsAuthor.fromJson(dynamic json):
  
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

  GetPostCommentsCommentsAuthor({
    required this.id,
    required this.username,
    this.displayName,
    this.profilePictureUrl,
  });
}

class GetPostCommentsData {
  List<GetPostCommentsComments> comments;
  GetPostCommentsData.fromJson(dynamic json):
  
  comments = (json['comments'] as List<dynamic>)
        .map((e) => GetPostCommentsComments.fromJson(e))
        .toList();

  Map<String, dynamic> toJson() {
    Map<String, dynamic> json = {};
    json['comments'] = comments.map((e) => e.toJson()).toList();
    return json;
  }

  GetPostCommentsData({
    required this.comments,
  });
}

class GetPostCommentsVariables {
  String postId;
  @Deprecated('fromJson is deprecated for Variable classes as they are no longer required for deserialization.')
  GetPostCommentsVariables.fromJson(Map<String, dynamic> json):
  
  postId = nativeFromJson<String>(json['postId']);

  Map<String, dynamic> toJson() {
    Map<String, dynamic> json = {};
    json['postId'] = nativeToJson<String>(postId);
    return json;
  }

  GetPostCommentsVariables({
    required this.postId,
  });
}


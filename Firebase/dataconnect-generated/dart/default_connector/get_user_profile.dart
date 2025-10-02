part of 'default.dart';

class GetUserProfileVariablesBuilder {
  String userId;

  final FirebaseDataConnect _dataConnect;
  GetUserProfileVariablesBuilder(this._dataConnect, {required  this.userId,});
  Deserializer<GetUserProfileData> dataDeserializer = (dynamic json)  => GetUserProfileData.fromJson(jsonDecode(json));
  Serializer<GetUserProfileVariables> varsSerializer = (GetUserProfileVariables vars) => jsonEncode(vars.toJson());
  Future<QueryResult<GetUserProfileData, GetUserProfileVariables>> execute() {
    return ref().execute();
  }

  QueryRef<GetUserProfileData, GetUserProfileVariables> ref() {
    GetUserProfileVariables vars= GetUserProfileVariables(userId: userId,);
    return _dataConnect.query("GetUserProfile", dataDeserializer, varsSerializer, vars);
  }
}

class GetUserProfileUser {
  String id;
  String username;
  String? displayName;
  String? bio;
  String? profilePictureUrl;
  Timestamp createdAt;
  GetUserProfileUser.fromJson(dynamic json):
  
  id = nativeFromJson<String>(json['id']),
  username = nativeFromJson<String>(json['username']),
  displayName = json['displayName'] == null ? null : nativeFromJson<String>(json['displayName']),
  bio = json['bio'] == null ? null : nativeFromJson<String>(json['bio']),
  profilePictureUrl = json['profilePictureUrl'] == null ? null : nativeFromJson<String>(json['profilePictureUrl']),
  createdAt = Timestamp.fromJson(json['createdAt']);

  Map<String, dynamic> toJson() {
    Map<String, dynamic> json = {};
    json['id'] = nativeToJson<String>(id);
    json['username'] = nativeToJson<String>(username);
    if (displayName != null) {
      json['displayName'] = nativeToJson<String?>(displayName);
    }
    if (bio != null) {
      json['bio'] = nativeToJson<String?>(bio);
    }
    if (profilePictureUrl != null) {
      json['profilePictureUrl'] = nativeToJson<String?>(profilePictureUrl);
    }
    json['createdAt'] = createdAt.toJson();
    return json;
  }

  GetUserProfileUser({
    required this.id,
    required this.username,
    this.displayName,
    this.bio,
    this.profilePictureUrl,
    required this.createdAt,
  });
}

class GetUserProfileData {
  GetUserProfileUser? user;
  GetUserProfileData.fromJson(dynamic json):
  
  user = json['user'] == null ? null : GetUserProfileUser.fromJson(json['user']);

  Map<String, dynamic> toJson() {
    Map<String, dynamic> json = {};
    if (user != null) {
      json['user'] = user!.toJson();
    }
    return json;
  }

  GetUserProfileData({
    this.user,
  });
}

class GetUserProfileVariables {
  String userId;
  @Deprecated('fromJson is deprecated for Variable classes as they are no longer required for deserialization.')
  GetUserProfileVariables.fromJson(Map<String, dynamic> json):
  
  userId = nativeFromJson<String>(json['userId']);

  Map<String, dynamic> toJson() {
    Map<String, dynamic> json = {};
    json['userId'] = nativeToJson<String>(userId);
    return json;
  }

  GetUserProfileVariables({
    required this.userId,
  });
}


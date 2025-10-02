part of 'default.dart';

class SearchUsersVariablesBuilder {
  String username;

  final FirebaseDataConnect _dataConnect;
  SearchUsersVariablesBuilder(this._dataConnect, {required  this.username,});
  Deserializer<SearchUsersData> dataDeserializer = (dynamic json)  => SearchUsersData.fromJson(jsonDecode(json));
  Serializer<SearchUsersVariables> varsSerializer = (SearchUsersVariables vars) => jsonEncode(vars.toJson());
  Future<QueryResult<SearchUsersData, SearchUsersVariables>> execute() {
    return ref().execute();
  }

  QueryRef<SearchUsersData, SearchUsersVariables> ref() {
    SearchUsersVariables vars= SearchUsersVariables(username: username,);
    return _dataConnect.query("SearchUsers", dataDeserializer, varsSerializer, vars);
  }
}

class SearchUsersUsers {
  String id;
  String username;
  String? displayName;
  String? profilePictureUrl;
  SearchUsersUsers.fromJson(dynamic json):
  
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

  SearchUsersUsers({
    required this.id,
    required this.username,
    this.displayName,
    this.profilePictureUrl,
  });
}

class SearchUsersData {
  List<SearchUsersUsers> users;
  SearchUsersData.fromJson(dynamic json):
  
  users = (json['users'] as List<dynamic>)
        .map((e) => SearchUsersUsers.fromJson(e))
        .toList();

  Map<String, dynamic> toJson() {
    Map<String, dynamic> json = {};
    json['users'] = users.map((e) => e.toJson()).toList();
    return json;
  }

  SearchUsersData({
    required this.users,
  });
}

class SearchUsersVariables {
  String username;
  @Deprecated('fromJson is deprecated for Variable classes as they are no longer required for deserialization.')
  SearchUsersVariables.fromJson(Map<String, dynamic> json):
  
  username = nativeFromJson<String>(json['username']);

  Map<String, dynamic> toJson() {
    Map<String, dynamic> json = {};
    json['username'] = nativeToJson<String>(username);
    return json;
  }

  SearchUsersVariables({
    required this.username,
  });
}


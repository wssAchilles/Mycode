part of 'default.dart';

class GetFollowersVariablesBuilder {
  
  final FirebaseDataConnect _dataConnect;
  GetFollowersVariablesBuilder(this._dataConnect, );
  Deserializer<GetFollowersData> dataDeserializer = (dynamic json)  => GetFollowersData.fromJson(jsonDecode(json));
  
  Future<QueryResult<GetFollowersData, void>> execute() {
    return ref().execute();
  }

  QueryRef<GetFollowersData, void> ref() {
    
    return _dataConnect.query("GetFollowers", dataDeserializer, emptySerializer, null);
  }
}

class GetFollowersFollows {
  GetFollowersFollowsFollower follower;
  GetFollowersFollows.fromJson(dynamic json):
  
  follower = GetFollowersFollowsFollower.fromJson(json['follower']);

  Map<String, dynamic> toJson() {
    Map<String, dynamic> json = {};
    json['follower'] = follower.toJson();
    return json;
  }

  GetFollowersFollows({
    required this.follower,
  });
}

class GetFollowersFollowsFollower {
  String id;
  String username;
  GetFollowersFollowsFollower.fromJson(dynamic json):
  
  id = nativeFromJson<String>(json['id']),
  username = nativeFromJson<String>(json['username']);

  Map<String, dynamic> toJson() {
    Map<String, dynamic> json = {};
    json['id'] = nativeToJson<String>(id);
    json['username'] = nativeToJson<String>(username);
    return json;
  }

  GetFollowersFollowsFollower({
    required this.id,
    required this.username,
  });
}

class GetFollowersData {
  List<GetFollowersFollows> follows;
  GetFollowersData.fromJson(dynamic json):
  
  follows = (json['follows'] as List<dynamic>)
        .map((e) => GetFollowersFollows.fromJson(e))
        .toList();

  Map<String, dynamic> toJson() {
    Map<String, dynamic> json = {};
    json['follows'] = follows.map((e) => e.toJson()).toList();
    return json;
  }

  GetFollowersData({
    required this.follows,
  });
}


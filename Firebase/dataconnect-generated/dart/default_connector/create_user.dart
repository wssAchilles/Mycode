part of 'default.dart';

class CreateUserVariablesBuilder {
  String username;
  String email;
  Optional<String> _displayName = Optional.optional(nativeFromJson, nativeToJson);

  final FirebaseDataConnect _dataConnect;  CreateUserVariablesBuilder displayName(String? t) {
   _displayName.value = t;
   return this;
  }

  CreateUserVariablesBuilder(this._dataConnect, {required  this.username,required  this.email,});
  Deserializer<CreateUserData> dataDeserializer = (dynamic json)  => CreateUserData.fromJson(jsonDecode(json));
  Serializer<CreateUserVariables> varsSerializer = (CreateUserVariables vars) => jsonEncode(vars.toJson());
  Future<OperationResult<CreateUserData, CreateUserVariables>> execute() {
    return ref().execute();
  }

  MutationRef<CreateUserData, CreateUserVariables> ref() {
    CreateUserVariables vars= CreateUserVariables(username: username,email: email,displayName: _displayName,);
    return _dataConnect.mutation("CreateUser", dataDeserializer, varsSerializer, vars);
  }
}

class CreateUserUserInsert {
  String id;
  CreateUserUserInsert.fromJson(dynamic json):
  
  id = nativeFromJson<String>(json['id']);

  Map<String, dynamic> toJson() {
    Map<String, dynamic> json = {};
    json['id'] = nativeToJson<String>(id);
    return json;
  }

  CreateUserUserInsert({
    required this.id,
  });
}

class CreateUserData {
  CreateUserUserInsert user_insert;
  CreateUserData.fromJson(dynamic json):
  
  user_insert = CreateUserUserInsert.fromJson(json['user_insert']);

  Map<String, dynamic> toJson() {
    Map<String, dynamic> json = {};
    json['user_insert'] = user_insert.toJson();
    return json;
  }

  CreateUserData({
    required this.user_insert,
  });
}

class CreateUserVariables {
  String username;
  String email;
  late Optional<String>displayName;
  @Deprecated('fromJson is deprecated for Variable classes as they are no longer required for deserialization.')
  CreateUserVariables.fromJson(Map<String, dynamic> json):
  
  username = nativeFromJson<String>(json['username']),
  email = nativeFromJson<String>(json['email']) {
  
  
  
  
    displayName = Optional.optional(nativeFromJson, nativeToJson);
    displayName.value = json['displayName'] == null ? null : nativeFromJson<String>(json['displayName']);
  
  }

  Map<String, dynamic> toJson() {
    Map<String, dynamic> json = {};
    json['username'] = nativeToJson<String>(username);
    json['email'] = nativeToJson<String>(email);
    if(displayName.state == OptionalState.set) {
      json['displayName'] = displayName.toJson();
    }
    return json;
  }

  CreateUserVariables({
    required this.username,
    required this.email,
    required this.displayName,
  });
}


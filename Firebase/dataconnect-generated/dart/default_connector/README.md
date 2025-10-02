# default_connector SDK

## Installation
```sh
flutter pub get firebase_data_connect
flutterfire configure
```
For more information, see [Flutter for Firebase installation documentation](https://firebase.google.com/docs/data-connect/flutter-sdk#use-core).

## Data Connect instance
Each connector creates a static class, with an instance of the `DataConnect` class that can be used to connect to your Data Connect backend and call operations.

### Connecting to the emulator

```dart
String host = 'localhost'; // or your host name
int port = 9399; // or your port number
DefaultConnector.instance.dataConnect.useDataConnectEmulator(host, port);
```

You can also call queries and mutations by using the connector class.
## Queries

### GetPostsByUser
#### Required Arguments
```dart
// No required arguments
DefaultConnector.instance.getPostsByUser().execute();
```



#### Return Type
`execute()` returns a `QueryResult<GetPostsByUserData, void>`
```dart
/// Result of an Operation Request (query/mutation).
class OperationResult<Data, Variables> {
  OperationResult(this.dataConnect, this.data, this.ref);
  Data data;
  OperationRef<Data, Variables> ref;
  FirebaseDataConnect dataConnect;
}

/// Result of a query request. Created to hold extra variables in the future.
class QueryResult<Data, Variables> extends OperationResult<Data, Variables> {
  QueryResult(super.dataConnect, super.data, super.ref);
}

final result = await DefaultConnector.instance.getPostsByUser();
GetPostsByUserData data = result.data;
final ref = result.ref;
```

#### Getting the Ref
Each builder returns an `execute` function, which is a helper function that creates a `Ref` object, and executes the underlying operation.
An example of how to use the `Ref` object is shown below:
```dart
final ref = DefaultConnector.instance.getPostsByUser().ref();
ref.execute();

ref.subscribe(...);
```


### GetFollowers
#### Required Arguments
```dart
// No required arguments
DefaultConnector.instance.getFollowers().execute();
```



#### Return Type
`execute()` returns a `QueryResult<GetFollowersData, void>`
```dart
/// Result of an Operation Request (query/mutation).
class OperationResult<Data, Variables> {
  OperationResult(this.dataConnect, this.data, this.ref);
  Data data;
  OperationRef<Data, Variables> ref;
  FirebaseDataConnect dataConnect;
}

/// Result of a query request. Created to hold extra variables in the future.
class QueryResult<Data, Variables> extends OperationResult<Data, Variables> {
  QueryResult(super.dataConnect, super.data, super.ref);
}

final result = await DefaultConnector.instance.getFollowers();
GetFollowersData data = result.data;
final ref = result.ref;
```

#### Getting the Ref
Each builder returns an `execute` function, which is a helper function that creates a `Ref` object, and executes the underlying operation.
An example of how to use the `Ref` object is shown below:
```dart
final ref = DefaultConnector.instance.getFollowers().ref();
ref.execute();

ref.subscribe(...);
```


### GetLikesForPost
#### Required Arguments
```dart
String postId = ...;
DefaultConnector.instance.getLikesForPost(
  postId: postId,
).execute();
```



#### Return Type
`execute()` returns a `QueryResult<GetLikesForPostData, GetLikesForPostVariables>`
```dart
/// Result of an Operation Request (query/mutation).
class OperationResult<Data, Variables> {
  OperationResult(this.dataConnect, this.data, this.ref);
  Data data;
  OperationRef<Data, Variables> ref;
  FirebaseDataConnect dataConnect;
}

/// Result of a query request. Created to hold extra variables in the future.
class QueryResult<Data, Variables> extends OperationResult<Data, Variables> {
  QueryResult(super.dataConnect, super.data, super.ref);
}

final result = await DefaultConnector.instance.getLikesForPost(
  postId: postId,
);
GetLikesForPostData data = result.data;
final ref = result.ref;
```

#### Getting the Ref
Each builder returns an `execute` function, which is a helper function that creates a `Ref` object, and executes the underlying operation.
An example of how to use the `Ref` object is shown below:
```dart
String postId = ...;

final ref = DefaultConnector.instance.getLikesForPost(
  postId: postId,
).ref();
ref.execute();

ref.subscribe(...);
```


### GetAllPosts
#### Required Arguments
```dart
// No required arguments
DefaultConnector.instance.getAllPosts().execute();
```



#### Return Type
`execute()` returns a `QueryResult<GetAllPostsData, void>`
```dart
/// Result of an Operation Request (query/mutation).
class OperationResult<Data, Variables> {
  OperationResult(this.dataConnect, this.data, this.ref);
  Data data;
  OperationRef<Data, Variables> ref;
  FirebaseDataConnect dataConnect;
}

/// Result of a query request. Created to hold extra variables in the future.
class QueryResult<Data, Variables> extends OperationResult<Data, Variables> {
  QueryResult(super.dataConnect, super.data, super.ref);
}

final result = await DefaultConnector.instance.getAllPosts();
GetAllPostsData data = result.data;
final ref = result.ref;
```

#### Getting the Ref
Each builder returns an `execute` function, which is a helper function that creates a `Ref` object, and executes the underlying operation.
An example of how to use the `Ref` object is shown below:
```dart
final ref = DefaultConnector.instance.getAllPosts().ref();
ref.execute();

ref.subscribe(...);
```


### GetPostComments
#### Required Arguments
```dart
String postId = ...;
DefaultConnector.instance.getPostComments(
  postId: postId,
).execute();
```



#### Return Type
`execute()` returns a `QueryResult<GetPostCommentsData, GetPostCommentsVariables>`
```dart
/// Result of an Operation Request (query/mutation).
class OperationResult<Data, Variables> {
  OperationResult(this.dataConnect, this.data, this.ref);
  Data data;
  OperationRef<Data, Variables> ref;
  FirebaseDataConnect dataConnect;
}

/// Result of a query request. Created to hold extra variables in the future.
class QueryResult<Data, Variables> extends OperationResult<Data, Variables> {
  QueryResult(super.dataConnect, super.data, super.ref);
}

final result = await DefaultConnector.instance.getPostComments(
  postId: postId,
);
GetPostCommentsData data = result.data;
final ref = result.ref;
```

#### Getting the Ref
Each builder returns an `execute` function, which is a helper function that creates a `Ref` object, and executes the underlying operation.
An example of how to use the `Ref` object is shown below:
```dart
String postId = ...;

final ref = DefaultConnector.instance.getPostComments(
  postId: postId,
).ref();
ref.execute();

ref.subscribe(...);
```


### GetUserProfile
#### Required Arguments
```dart
String userId = ...;
DefaultConnector.instance.getUserProfile(
  userId: userId,
).execute();
```



#### Return Type
`execute()` returns a `QueryResult<GetUserProfileData, GetUserProfileVariables>`
```dart
/// Result of an Operation Request (query/mutation).
class OperationResult<Data, Variables> {
  OperationResult(this.dataConnect, this.data, this.ref);
  Data data;
  OperationRef<Data, Variables> ref;
  FirebaseDataConnect dataConnect;
}

/// Result of a query request. Created to hold extra variables in the future.
class QueryResult<Data, Variables> extends OperationResult<Data, Variables> {
  QueryResult(super.dataConnect, super.data, super.ref);
}

final result = await DefaultConnector.instance.getUserProfile(
  userId: userId,
);
GetUserProfileData data = result.data;
final ref = result.ref;
```

#### Getting the Ref
Each builder returns an `execute` function, which is a helper function that creates a `Ref` object, and executes the underlying operation.
An example of how to use the `Ref` object is shown below:
```dart
String userId = ...;

final ref = DefaultConnector.instance.getUserProfile(
  userId: userId,
).ref();
ref.execute();

ref.subscribe(...);
```


### SearchUsers
#### Required Arguments
```dart
String username = ...;
DefaultConnector.instance.searchUsers(
  username: username,
).execute();
```



#### Return Type
`execute()` returns a `QueryResult<SearchUsersData, SearchUsersVariables>`
```dart
/// Result of an Operation Request (query/mutation).
class OperationResult<Data, Variables> {
  OperationResult(this.dataConnect, this.data, this.ref);
  Data data;
  OperationRef<Data, Variables> ref;
  FirebaseDataConnect dataConnect;
}

/// Result of a query request. Created to hold extra variables in the future.
class QueryResult<Data, Variables> extends OperationResult<Data, Variables> {
  QueryResult(super.dataConnect, super.data, super.ref);
}

final result = await DefaultConnector.instance.searchUsers(
  username: username,
);
SearchUsersData data = result.data;
final ref = result.ref;
```

#### Getting the Ref
Each builder returns an `execute` function, which is a helper function that creates a `Ref` object, and executes the underlying operation.
An example of how to use the `Ref` object is shown below:
```dart
String username = ...;

final ref = DefaultConnector.instance.searchUsers(
  username: username,
).ref();
ref.execute();

ref.subscribe(...);
```

## Mutations

### CreatePost
#### Required Arguments
```dart
// No required arguments
DefaultConnector.instance.createPost().execute();
```



#### Return Type
`execute()` returns a `OperationResult<CreatePostData, void>`
```dart
/// Result of an Operation Request (query/mutation).
class OperationResult<Data, Variables> {
  OperationResult(this.dataConnect, this.data, this.ref);
  Data data;
  OperationRef<Data, Variables> ref;
  FirebaseDataConnect dataConnect;
}

final result = await DefaultConnector.instance.createPost();
CreatePostData data = result.data;
final ref = result.ref;
```

#### Getting the Ref
Each builder returns an `execute` function, which is a helper function that creates a `Ref` object, and executes the underlying operation.
An example of how to use the `Ref` object is shown below:
```dart
final ref = DefaultConnector.instance.createPost().ref();
ref.execute();
```


### FollowUser
#### Required Arguments
```dart
String followingId = ...;
DefaultConnector.instance.followUser(
  followingId: followingId,
).execute();
```



#### Return Type
`execute()` returns a `OperationResult<FollowUserData, FollowUserVariables>`
```dart
/// Result of an Operation Request (query/mutation).
class OperationResult<Data, Variables> {
  OperationResult(this.dataConnect, this.data, this.ref);
  Data data;
  OperationRef<Data, Variables> ref;
  FirebaseDataConnect dataConnect;
}

final result = await DefaultConnector.instance.followUser(
  followingId: followingId,
);
FollowUserData data = result.data;
final ref = result.ref;
```

#### Getting the Ref
Each builder returns an `execute` function, which is a helper function that creates a `Ref` object, and executes the underlying operation.
An example of how to use the `Ref` object is shown below:
```dart
String followingId = ...;

final ref = DefaultConnector.instance.followUser(
  followingId: followingId,
).ref();
ref.execute();
```


### LikePost
#### Required Arguments
```dart
String postId = ...;
DefaultConnector.instance.likePost(
  postId: postId,
).execute();
```



#### Return Type
`execute()` returns a `OperationResult<LikePostData, LikePostVariables>`
```dart
/// Result of an Operation Request (query/mutation).
class OperationResult<Data, Variables> {
  OperationResult(this.dataConnect, this.data, this.ref);
  Data data;
  OperationRef<Data, Variables> ref;
  FirebaseDataConnect dataConnect;
}

final result = await DefaultConnector.instance.likePost(
  postId: postId,
);
LikePostData data = result.data;
final ref = result.ref;
```

#### Getting the Ref
Each builder returns an `execute` function, which is a helper function that creates a `Ref` object, and executes the underlying operation.
An example of how to use the `Ref` object is shown below:
```dart
String postId = ...;

final ref = DefaultConnector.instance.likePost(
  postId: postId,
).ref();
ref.execute();
```


### CreateComment
#### Required Arguments
```dart
String postId = ...;
String text = ...;
DefaultConnector.instance.createComment(
  postId: postId,
  text: text,
).execute();
```



#### Return Type
`execute()` returns a `OperationResult<CreateCommentData, CreateCommentVariables>`
```dart
/// Result of an Operation Request (query/mutation).
class OperationResult<Data, Variables> {
  OperationResult(this.dataConnect, this.data, this.ref);
  Data data;
  OperationRef<Data, Variables> ref;
  FirebaseDataConnect dataConnect;
}

final result = await DefaultConnector.instance.createComment(
  postId: postId,
  text: text,
);
CreateCommentData data = result.data;
final ref = result.ref;
```

#### Getting the Ref
Each builder returns an `execute` function, which is a helper function that creates a `Ref` object, and executes the underlying operation.
An example of how to use the `Ref` object is shown below:
```dart
String postId = ...;
String text = ...;

final ref = DefaultConnector.instance.createComment(
  postId: postId,
  text: text,
).ref();
ref.execute();
```


### CreateUser
#### Required Arguments
```dart
String username = ...;
String email = ...;
DefaultConnector.instance.createUser(
  username: username,
  email: email,
).execute();
```

#### Optional Arguments
We return a builder for each query. For CreateUser, we created `CreateUserBuilder`. For queries and mutations with optional parameters, we return a builder class.
The builder pattern allows Data Connect to distinguish between fields that haven't been set and fields that have been set to null. A field can be set by calling its respective setter method like below:
```dart
class CreateUserVariablesBuilder {
  ...
   CreateUserVariablesBuilder displayName(String? t) {
   _displayName.value = t;
   return this;
  }

  ...
}
DefaultConnector.instance.createUser(
  username: username,
  email: email,
)
.displayName(displayName)
.execute();
```

#### Return Type
`execute()` returns a `OperationResult<CreateUserData, CreateUserVariables>`
```dart
/// Result of an Operation Request (query/mutation).
class OperationResult<Data, Variables> {
  OperationResult(this.dataConnect, this.data, this.ref);
  Data data;
  OperationRef<Data, Variables> ref;
  FirebaseDataConnect dataConnect;
}

final result = await DefaultConnector.instance.createUser(
  username: username,
  email: email,
);
CreateUserData data = result.data;
final ref = result.ref;
```

#### Getting the Ref
Each builder returns an `execute` function, which is a helper function that creates a `Ref` object, and executes the underlying operation.
An example of how to use the `Ref` object is shown below:
```dart
String username = ...;
String email = ...;

final ref = DefaultConnector.instance.createUser(
  username: username,
  email: email,
).ref();
ref.execute();
```


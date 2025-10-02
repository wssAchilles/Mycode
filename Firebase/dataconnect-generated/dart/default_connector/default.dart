library default_connector;
import 'package:firebase_data_connect/firebase_data_connect.dart';
import 'dart:convert';

part 'create_post.dart';

part 'get_posts_by_user.dart';

part 'follow_user.dart';

part 'get_followers.dart';

part 'like_post.dart';

part 'get_likes_for_post.dart';

part 'create_comment.dart';

part 'get_all_posts.dart';

part 'get_post_comments.dart';

part 'create_user.dart';

part 'get_user_profile.dart';

part 'search_users.dart';







class DefaultConnector {
  
  
  CreatePostVariablesBuilder createPost () {
    return CreatePostVariablesBuilder(dataConnect, );
  }
  
  
  GetPostsByUserVariablesBuilder getPostsByUser () {
    return GetPostsByUserVariablesBuilder(dataConnect, );
  }
  
  
  FollowUserVariablesBuilder followUser ({required String followingId, }) {
    return FollowUserVariablesBuilder(dataConnect, followingId: followingId,);
  }
  
  
  GetFollowersVariablesBuilder getFollowers () {
    return GetFollowersVariablesBuilder(dataConnect, );
  }
  
  
  LikePostVariablesBuilder likePost ({required String postId, }) {
    return LikePostVariablesBuilder(dataConnect, postId: postId,);
  }
  
  
  GetLikesForPostVariablesBuilder getLikesForPost ({required String postId, }) {
    return GetLikesForPostVariablesBuilder(dataConnect, postId: postId,);
  }
  
  
  CreateCommentVariablesBuilder createComment ({required String postId, required String text, }) {
    return CreateCommentVariablesBuilder(dataConnect, postId: postId,text: text,);
  }
  
  
  GetAllPostsVariablesBuilder getAllPosts () {
    return GetAllPostsVariablesBuilder(dataConnect, );
  }
  
  
  GetPostCommentsVariablesBuilder getPostComments ({required String postId, }) {
    return GetPostCommentsVariablesBuilder(dataConnect, postId: postId,);
  }
  
  
  CreateUserVariablesBuilder createUser ({required String username, required String email, }) {
    return CreateUserVariablesBuilder(dataConnect, username: username,email: email,);
  }
  
  
  GetUserProfileVariablesBuilder getUserProfile ({required String userId, }) {
    return GetUserProfileVariablesBuilder(dataConnect, userId: userId,);
  }
  
  
  SearchUsersVariablesBuilder searchUsers ({required String username, }) {
    return SearchUsersVariablesBuilder(dataConnect, username: username,);
  }
  

  static ConnectorConfig connectorConfig = ConnectorConfig(
    'us-central1',
    'default',
    'xzqcjnb666-service',
  );

  DefaultConnector({required this.dataConnect});
  static DefaultConnector get instance {
    return DefaultConnector(
        dataConnect: FirebaseDataConnect.instanceFor(
            connectorConfig: connectorConfig,
            sdkType: CallerSDKType.generated));
  }

  FirebaseDataConnect dataConnect;
}


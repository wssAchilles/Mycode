package com.achilles.blog;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import java.util.List;

@Repository
public interface CommentRepository extends JpaRepository<Comment, Long> {

    /**
     * 根据文章ID查找所有评论
     * Spring Data JPA会根据方法名自动生成查询SQL
     */
    List<Comment> findByPostId(Long postId);
}

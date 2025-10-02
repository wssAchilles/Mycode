package com.achilles.blog;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface PostRepository extends JpaRepository<Post, Long> {
    // 所有基础的CRUD方法都通过继承JpaRepository自动获得
}

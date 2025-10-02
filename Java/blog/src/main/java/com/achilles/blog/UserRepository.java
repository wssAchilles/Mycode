package com.achilles.blog;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import java.util.Optional;

@Repository
public interface UserRepository extends JpaRepository<User, Long> {

    /**
     * 根据用户名查找用户
     * Spring Security将使用这个方法在登录时根据用户名查找用户
     */
    Optional<User> findByUsername(String username);
}

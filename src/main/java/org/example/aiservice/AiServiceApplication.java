package org.example.aiservice;


import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.web.client.RestTemplate;

@SpringBootApplication
public class AiServiceApplication {

    public static void main(String[] args) {
        SpringApplication.run(AiServiceApplication.class, args);
    }

    // 关键步骤：注册这个 Bean，这样我们在其他地方就能直接注入使用
    @Bean
    public RestTemplate restTemplate() {
        return new RestTemplate();
    }
}

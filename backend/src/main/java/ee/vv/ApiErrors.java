package ee.vv;

import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestControllerAdvice
class ApiErrors {
    @ExceptionHandler(ResponseStatusException.class)
    ProblemDetail status(ResponseStatusException error) {
        return ProblemDetail.forStatusAndDetail(error.getStatusCode(),error.getReason()==null?"Request failed":error.getReason());
    }
    @ExceptionHandler(MethodArgumentNotValidException.class)
    ProblemDetail invalid(MethodArgumentNotValidException error) {
        String detail=error.getBindingResult().getFieldErrors().stream()
            .map(e->e.getField()+": "+e.getDefaultMessage()).distinct().sorted()
            .collect(java.util.stream.Collectors.joining("; "));
        return ProblemDetail.forStatusAndDetail(org.springframework.http.HttpStatus.BAD_REQUEST,detail);
    }
}

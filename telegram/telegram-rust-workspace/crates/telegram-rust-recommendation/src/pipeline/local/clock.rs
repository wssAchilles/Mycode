use std::cell::RefCell;

use chrono::{DateTime, Utc};

// ponytail: replay is synchronous; pass an explicit context if ranking becomes multi-threaded.
thread_local! {
    static RANKING_CLOCK_OVERRIDE: RefCell<Option<DateTime<Utc>>> = const { RefCell::new(None) };
}

pub(crate) fn ranking_now() -> DateTime<Utc> {
    RANKING_CLOCK_OVERRIDE
        .with(|clock| *clock.borrow())
        .unwrap_or_else(Utc::now)
}

pub(crate) fn with_ranking_clock<T>(now: DateTime<Utc>, operation: impl FnOnce() -> T) -> T {
    let previous = RANKING_CLOCK_OVERRIDE.with(|clock| clock.replace(Some(now)));
    let _guard = RankingClockGuard(previous);
    operation()
}

struct RankingClockGuard(Option<DateTime<Utc>>);

impl Drop for RankingClockGuard {
    fn drop(&mut self) {
        RANKING_CLOCK_OVERRIDE.with(|clock| {
            clock.replace(self.0.take());
        });
    }
}

#[cfg(test)]
mod tests {
    use chrono::{TimeZone, Utc};

    use super::{ranking_now, with_ranking_clock};

    #[test]
    fn scoped_clock_restores_nested_and_panicking_overrides() {
        let outer = Utc.with_ymd_and_hms(2026, 1, 2, 3, 4, 5).unwrap();
        let inner = Utc.with_ymd_and_hms(2027, 2, 3, 4, 5, 6).unwrap();

        with_ranking_clock(outer, || {
            assert_eq!(ranking_now(), outer);
            with_ranking_clock(inner, || assert_eq!(ranking_now(), inner));
            assert_eq!(ranking_now(), outer);

            let result = std::panic::catch_unwind(|| {
                with_ranking_clock(inner, || panic!("expected test panic"));
            });
            assert!(result.is_err());
            assert_eq!(ranking_now(), outer);
        });

        assert_ne!(ranking_now(), outer);
    }
}

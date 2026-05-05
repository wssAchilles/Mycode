use std::time::Instant;

pub(super) struct StageTimer {
    started_at: Instant,
}

impl StageTimer {
    pub(super) fn start() -> Self {
        Self {
            started_at: Instant::now(),
        }
    }

    pub(super) fn elapsed_ms(&self) -> u64 {
        self.started_at.elapsed().as_millis() as u64
    }
}

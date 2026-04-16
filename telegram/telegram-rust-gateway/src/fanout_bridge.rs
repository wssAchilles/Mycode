use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FanoutBridgeSnapshot {
    pub active_user_targets: usize,
    pub active_room_targets: usize,
    pub last_updated_at: Option<String>,
}

#[derive(Debug, Default, Clone)]
pub struct FanoutBridge {
    active_user_targets: usize,
    active_room_targets: usize,
    last_updated_at: Option<String>,
}

impl FanoutBridge {
    pub fn refresh(&mut self, active_user_targets: usize, active_room_targets: usize, at: String) {
        self.active_user_targets = active_user_targets;
        self.active_room_targets = active_room_targets;
        self.last_updated_at = Some(at);
    }

    pub fn snapshot(&self) -> FanoutBridgeSnapshot {
        FanoutBridgeSnapshot {
            active_user_targets: self.active_user_targets,
            active_room_targets: self.active_room_targets,
            last_updated_at: self.last_updated_at.clone(),
        }
    }
}

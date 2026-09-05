use std::path::Path;
use tendril_core::config::{delete_master, write_master};

pub struct MasterGuard<'a> {
    tendril_home: &'a Path,
}

impl<'a> MasterGuard<'a> {
    pub fn acquire(tendril_home: &'a Path, port: u16, secret: &str) -> std::io::Result<Self> {
        let _ = write_master(tendril_home, port, secret);
        Ok(Self { tendril_home })
    }
}

impl<'a> Drop for MasterGuard<'a> {
    fn drop(&mut self) {
        delete_master(self.tendril_home);
    }
}

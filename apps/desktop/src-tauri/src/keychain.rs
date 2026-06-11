use keyring::Entry;

const SERVICE_NAME: &str = "com.routebox.app";
const TOKEN_KEY: &str = "api_token";
const CLOUD_TOKEN_KEY: &str = "cloud_api_token";
const DB_KEY_KEY: &str = "db_encryption_key";

pub fn store_token(token: &str) -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, TOKEN_KEY).map_err(|e| e.to_string())?;
    entry.set_password(token).map_err(|e| e.to_string())
}

pub fn get_token() -> Result<Option<String>, String> {
    let entry = Entry::new(SERVICE_NAME, TOKEN_KEY).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub fn delete_token() -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, TOKEN_KEY).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

pub fn store_cloud_token(token: &str) -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, CLOUD_TOKEN_KEY).map_err(|e| e.to_string())?;
    entry.set_password(token).map_err(|e| e.to_string())
}

pub fn get_cloud_token() -> Result<Option<String>, String> {
    let entry = Entry::new(SERVICE_NAME, CLOUD_TOKEN_KEY).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub fn delete_cloud_token() -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, CLOUD_TOKEN_KEY).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

pub fn store_db_key(key: &str) -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, DB_KEY_KEY).map_err(|e| e.to_string())?;
    entry.set_password(key).map_err(|e| e.to_string())
}

pub fn get_db_key() -> Result<Option<String>, String> {
    let entry = Entry::new(SERVICE_NAME, DB_KEY_KEY).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

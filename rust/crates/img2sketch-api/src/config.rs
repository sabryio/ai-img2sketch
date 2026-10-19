//! Server configuration, read from the `APP_` environment variables.
//!
//! The variable names and the defaults are the ones `infrastructure/config/settings.py` already
//! documents, because the Docker image, the compose file and the Tauri host all set them. An
//! operator switching implementations must not have to learn a second vocabulary.
//!
//! Unlike the pure crates, a presentation crate is allowed to read the environment — but it reads
//! it once, here, into a value, and everything downstream takes the value. That keeps `main` thin
//! and makes the defaults testable without mutating a process's environment.

use std::net::SocketAddr;

/// Origins the Tauri v2 webview and the Vite dev server use, and nothing else.
///
/// A desktop app that listens on the loopback interface should not accept a page from anywhere on
/// the internet, so the allowed set is enumerated rather than wildcarded.
pub const DEFAULT_CORS_ORIGINS: &[&str] = &[
    "http://localhost:1420",  // Tauri dev server (Vite default port)
    "http://localhost:3000",  // frontend/ dev server (`bun run dev`)
    "http://127.0.0.1:3000",  // same, reached over the loopback alias
    "http://tauri.localhost", // Tauri webview on Windows/Linux
    "tauri://localhost",      // Tauri webview on macOS
];

/// The default port the frontend and the container health check expect.
pub const DEFAULT_PORT: u16 = 8000;

/// Everything `main` needs to start listening.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerConfig {
    /// Interface to bind. `0.0.0.0` so the container can publish it.
    pub host: String,
    /// Port to bind.
    pub port: u16,
    /// Tracing filter, e.g. `info` or `img2sketch=debug`.
    pub log_level: String,
    /// Origins allowed to call the API from a browser context.
    pub cors_origins: Vec<String>,
}

/// Why the environment could not be turned into a configuration.
#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    /// A variable was present but not usable.
    #[error("{variable} is not valid: {reason}")]
    Invalid {
        /// Which variable.
        variable: &'static str,
        /// What was wrong with it.
        reason: String,
    },
    /// The host and port did not form an address.
    #[error("APP_HOST and APP_PORT do not form a socket address: {host}:{port}")]
    Address {
        /// The configured host.
        host: String,
        /// The configured port.
        port: u16,
    },
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            host: "0.0.0.0".to_string(),
            port: DEFAULT_PORT,
            log_level: "info".to_string(),
            cors_origins: DEFAULT_CORS_ORIGINS
                .iter()
                .map(|origin| (*origin).to_string())
                .collect(),
        }
    }
}

impl ServerConfig {
    /// Reads the configuration from the process environment.
    ///
    /// # Errors
    ///
    /// Returns [`ConfigError::Invalid`] when `APP_PORT` is not a port number or
    /// `APP_CORS_ORIGINS` is not a JSON list of strings.
    pub fn from_environment() -> Result<Self, ConfigError> {
        Self::from(|variable| std::env::var(variable).ok())
    }

    /// Builds the configuration from a variable lookup.
    ///
    /// The lookup is a parameter rather than a call to `std::env` so the defaults and the failure
    /// messages can be asserted without touching the process's real environment.
    ///
    /// # Errors
    ///
    /// As [`ServerConfig::from_environment`].
    pub fn from(variable: impl Fn(&str) -> Option<String>) -> Result<Self, ConfigError> {
        let defaults = Self::default();

        let host = variable("APP_HOST")
            .filter(|value| !value.is_empty())
            .unwrap_or(defaults.host);

        let port = match variable("APP_PORT").filter(|value| !value.is_empty()) {
            None => defaults.port,
            Some(value) => value.parse::<u16>().map_err(|error| ConfigError::Invalid {
                variable: "APP_PORT",
                reason: format!("{value:?} is not a port number ({error})"),
            })?,
        };

        let log_level = variable("APP_LOG_LEVEL")
            .filter(|value| !value.is_empty())
            .unwrap_or(defaults.log_level);

        let cors_origins = match variable("APP_CORS_ORIGINS").filter(|value| !value.is_empty()) {
            None => defaults.cors_origins,
            Some(value) => serde_json::from_str::<Vec<String>>(&value).map_err(|error| {
                ConfigError::Invalid {
                    variable: "APP_CORS_ORIGINS",
                    reason: format!("expected a JSON list of origins ({error})"),
                }
            })?,
        };

        Ok(Self {
            host,
            port,
            log_level,
            cors_origins,
        })
    }

    /// The address to bind.
    ///
    /// # Errors
    ///
    /// Returns [`ConfigError::Address`] when the host and port cannot form an address.
    pub fn socket_address(&self) -> Result<SocketAddr, ConfigError> {
        format!("{}:{}", self.host, self.port)
            .parse()
            .map_err(|_| ConfigError::Address {
                host: self.host.clone(),
                port: self.port,
            })
    }
}

#[cfg(test)]
mod tests {
    use super::{ConfigError, DEFAULT_CORS_ORIGINS, DEFAULT_PORT, ServerConfig};
    use std::collections::HashMap;

    fn lookup(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> + use<> {
        let map: HashMap<String, String> = pairs
            .iter()
            .map(|(key, value)| ((*key).to_string(), (*value).to_string()))
            .collect();
        move |variable: &str| map.get(variable).cloned()
    }

    #[test]
    fn an_empty_environment_gives_the_documented_defaults() {
        let config = ServerConfig::from(lookup(&[])).unwrap();
        assert_eq!(config.host, "0.0.0.0");
        assert_eq!(config.port, DEFAULT_PORT);
        assert_eq!(config.log_level, "info");
        assert_eq!(config.cors_origins.len(), DEFAULT_CORS_ORIGINS.len());
        assert!(
            config
                .cors_origins
                .contains(&"tauri://localhost".to_string())
        );
        assert_eq!(config.socket_address().unwrap().to_string(), "0.0.0.0:8000");
    }

    #[test]
    fn the_environment_overrides_everything_it_names() {
        let config = ServerConfig::from(lookup(&[
            ("APP_HOST", "127.0.0.1"),
            ("APP_PORT", "9000"),
            ("APP_LOG_LEVEL", "debug"),
            ("APP_CORS_ORIGINS", r#"["http://localhost:5173"]"#),
        ]))
        .unwrap();
        assert_eq!(config.host, "127.0.0.1");
        assert_eq!(config.port, 9000);
        assert_eq!(config.log_level, "debug");
        assert_eq!(config.cors_origins, vec!["http://localhost:5173"]);
        assert_eq!(
            config.socket_address().unwrap().to_string(),
            "127.0.0.1:9000"
        );
    }

    #[test]
    fn a_port_that_is_not_a_number_is_refused_rather_than_guessed() {
        let error = ServerConfig::from(lookup(&[("APP_PORT", "eight thousand")])).unwrap_err();
        assert!(matches!(
            error,
            ConfigError::Invalid {
                variable: "APP_PORT",
                ..
            }
        ));
        assert!(error.to_string().contains("eight thousand"));
    }

    #[test]
    fn a_port_outside_the_range_is_refused() {
        assert!(ServerConfig::from(lookup(&[("APP_PORT", "70000")])).is_err());
        assert!(ServerConfig::from(lookup(&[("APP_PORT", "0")])).is_ok());
    }

    #[test]
    fn origins_must_be_a_json_list() {
        let error =
            ServerConfig::from(lookup(&[("APP_CORS_ORIGINS", "localhost:3000")])).unwrap_err();
        assert!(matches!(
            error,
            ConfigError::Invalid {
                variable: "APP_CORS_ORIGINS",
                ..
            }
        ));
    }

    #[test]
    fn an_empty_variable_is_treated_as_absent() {
        let config = ServerConfig::from(lookup(&[("APP_HOST", ""), ("APP_PORT", "")])).unwrap();
        assert_eq!(config.host, "0.0.0.0");
        assert_eq!(config.port, DEFAULT_PORT);
    }
}

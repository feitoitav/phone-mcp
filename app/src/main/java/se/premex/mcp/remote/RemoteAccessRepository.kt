package se.premex.mcp.remote

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

data class RemoteAccessConfig(
    val enabled: Boolean = false,
    val deviceId: String? = null,
    val deviceSecret: String? = null,
    val relayUrlOverride: String? = null,
) {
    val registered: Boolean get() = deviceId != null && deviceSecret != null

    /** Feito relay. Override is stored on device; default is our host, never phonemcp.ai. */
    val relayUrl: String
        get() = relayUrlOverride?.trim()?.trimEnd('/')?.takeIf { it.isNotEmpty() } ?: RELAY_URL

    companion object {
        const val RELAY_URL = "https://relay.feitoitav.com"
    }
}

/** Persists the Remote access (Feito Azure tunnel) settings. */
@Singleton
class RemoteAccessRepository @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    companion object {
        private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "remote_access")
        private val ENABLED = booleanPreferencesKey("enabled")
        private val DEVICE_ID = stringPreferencesKey("device_id")
        private val DEVICE_SECRET = stringPreferencesKey("device_secret")
        private val RELAY_URL_OVERRIDE = stringPreferencesKey("relay_url")
    }

    fun config(): Flow<RemoteAccessConfig> = context.dataStore.data.map { preferences ->
        RemoteAccessConfig(
            enabled = preferences[ENABLED] ?: false,
            deviceId = preferences[DEVICE_ID],
            deviceSecret = preferences[DEVICE_SECRET],
            relayUrlOverride = preferences[RELAY_URL_OVERRIDE],
        )
    }

    suspend fun setEnabled(enabled: Boolean) {
        context.dataStore.edit { it[ENABLED] = enabled }
    }

    suspend fun setRelayUrl(relayUrl: String?) {
        context.dataStore.edit { prefs ->
            val trimmed = relayUrl?.trim()?.trimEnd('/')
            if (trimmed.isNullOrEmpty()) prefs.remove(RELAY_URL_OVERRIDE)
            else prefs[RELAY_URL_OVERRIDE] = trimmed
        }
    }

    suspend fun saveDevice(deviceId: String, deviceSecret: String) {
        context.dataStore.edit {
            it[DEVICE_ID] = deviceId
            it[DEVICE_SECRET] = deviceSecret
        }
    }
}

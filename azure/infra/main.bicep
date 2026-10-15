// Feito MCP relay on Azure Container Apps. Product: Engineering.
// PARAMETERIZED ONLY. No subscription, resource group, hostname or secret is hardcoded. Not deployed.
targetScope = 'resourceGroup'

@description('Azure region (from Frank)')
param location string
param namePrefix string = 'feito-relay'
@description('Container image, e.g. <registry>/feito-mcp-relay:<tag>')
param image string
@description('Existing Key Vault holding the DEVICES_JSON registry (hashes only)')
param keyVaultName string
param devicesSecretName string = 'devices-json'
@description('Custom hostname (from Frank). Empty = default *.azurecontainerapps.io')
param customHostname string = ''
@description('Certificate resource id for customHostname')
param certificateId string = ''

resource logs 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: '${namePrefix}-logs'
  location: location
  properties: { sku: { name: 'PerGB2018' }, retentionInDays: 30 }
}

resource env 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${namePrefix}-env'
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
  }
}

resource kv 'Microsoft.KeyVault/vaults@2023-07-01' existing = { name: keyVaultName }

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${namePrefix}-app'
  location: location
  identity: { type: 'SystemAssigned' }
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      ingress: {
        external: true
        targetPort: 8080
        transport: 'http' // WebSocket upgrade works on http transport
        allowInsecure: false
        customDomains: empty(customHostname) ? [] : [ {
          name: customHostname
          certificateId: certificateId
          bindingType: 'SniEnabled'
        } ]
      }
      secrets: [ {
        name: 'devices-json'
        keyVaultUrl: '${kv.properties.vaultUri}secrets/${devicesSecretName}'
        identity: 'system'
      } ]
    }
    template: {
      containers: [ {
        name: 'relay'
        image: image
        resources: { cpu: json('0.25'), memory: '0.5Gi' }
        env: [ { name: 'DEVICES_JSON', secretRef: 'devices-json' }, { name: 'PORT', value: '8080' } ]
        probes: [ { type: 'Liveness', httpGet: { path: '/healthz', port: 8080 } } ]
      } ]
      // Single replica: tunnels live in memory. Scale-out needs a shared broker.
      scale: { minReplicas: 1, maxReplicas: 1 }
    }
  }
}

// The app identity still needs 'Key Vault Secrets User' on the vault (grant separately, after approval).
output fqdn string = app.properties.configuration.ingress.fqdn
output principalId string = app.identity.principalId

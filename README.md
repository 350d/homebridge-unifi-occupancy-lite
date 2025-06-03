# Homebridge UniFi Occupancy Lite

[![npm version](https://badge.fury.io/js/homebridge-unifi-occupancy-lite.svg)](https://badge.fury.io/js/homebridge-unifi-occupancy-lite)
[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)

A lightweight Homebridge plugin that creates occupancy sensors based on UniFi device presence detection. Track residents by their devices and create room-specific presence sensors.

## Features

🏠 **Resident-Based Tracking** - Configure residents with their specific devices  
📱 **Multi-Device Support** - Each resident can have multiple devices (phone, laptop, tablet, etc.)  
🌐 **Global Presence Sensor** - Single sensor showing if anyone is home  
📍 **Room-Specific Sensors** - Individual sensors for each WiFi access point/room  
🔌 **Dual API Support** - Works with local UniFi controllers and cloud Site Manager API  
📊 **Traffic Monitoring** - Optional minimum traffic thresholds to detect active usage  
⚡ **Lightweight** - Minimal resource usage, API token authentication only  

## Supported UniFi Devices

- UDM Pro / UDM Pro SE / UDM Pro Max
- UDM / UDM SE
- UDR (UniFi Dream Router)
- UCK-G2-PLUS (CloudKey Gen2 Plus)
- UNVR (UniFi Network Video Recorder)
- Any UniFi OS device with Network application

## Installation

### Via Homebridge UI (Recommended)

1. Search for "UniFi Occupancy Lite" in the Homebridge UI
2. Install the plugin
3. Configure using the web interface

### Via Command Line

```bash
npm install -g homebridge-unifi-occupancy-lite
```

## Configuration

### Basic Setup

Add this platform to your Homebridge `config.json`:

```json
{
  "platforms": [
    {
      "platform": "UnifiOccupancyLite",
      "unifi": {
        "controller": "https://192.168.1.1",
        "apiKey": "your-api-key-here"
      }
    }
  ]
}
```

### Complete Configuration Example

```json
{
  "platforms": [
    {
      "platform": "UnifiOccupancyLite",
      "unifi": {
        "controller": "https://192.168.1.1",
        "apiKey": "your-api-key-here",
        "useSiteManagerApi": false,
        "site": "default",
        "secure": false
      },
      "interval": 180,
      "globalPresenceSensor": true,
      "residents": [
        {
          "name": "John",
          "devices": [
            {
              "name": "John's iPhone",
              "mac": "AA:BB:CC:DD:EE:FF",
              "minTrafficAmount": 50
            },
            {
              "name": "John's MacBook",
              "hostname": "johns-macbook",
              "ip": "192.168.1.100"
            }
          ]
        },
        {
          "name": "Mary",
          "devices": [
            {
              "name": "Mary's Phone",
              "mac": "BB:CC:DD:EE:FF:AA"
            }
          ]
        }
      ],
      "wifiPoints": [
        {
          "name": "Living Room",
          "mac": "CC:DD:EE:FF:AA:BB"
        },
        {
          "name": "Bedroom",
          "ip": "192.168.1.10"
        }
      ]
    }
  ]
}
```

## Getting Your API Key

### Local Controller API Key

1. Open your UniFi Network Controller web interface
2. Go to **Settings** → **System** → **API**
3. Enable "Enable API" if not already enabled
4. Create a new API token or use existing one
5. Copy the API key for your configuration

### Site Manager API Key (Cloud)

1. Log in to [UniFi Cloud Console](https://unifi.ui.com)
2. Go to **Account** → **API Tokens**
3. Create a new token with appropriate permissions
4. Set `useSiteManagerApi: true` and provide your `hostId`

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `unifi.controller` | string | **required** | URL of your UniFi controller |
| `unifi.apiKey` | string | **required** | API key from UniFi Network settings |
| `unifi.useSiteManagerApi` | boolean | `false` | Use Site Manager API instead of local controller |
| `unifi.hostId` | string | - | Host ID for Site Manager API (required when using cloud API) |
| `unifi.site` | string | `"default"` | UniFi site name |
| `unifi.secure` | boolean | `false` | Enable SSL certificate validation |
| `interval` | number | `180` | Refresh interval in seconds (30-3600) |
| `globalPresenceSensor` | boolean | `true` | Create global presence sensor |
| `residents` | array | `[]` | List of residents and their devices |
| `wifiPoints` | array | `[]` | List of WiFi access points for room sensors |

### Resident Configuration

| Option | Type | Description |
|--------|------|-------------|
| `name` | string | Display name for the resident |
| `devices` | array | List of devices belonging to this resident |

### Device Configuration

| Option | Type | Description |
|--------|------|-------------|
| `name` | string | Display name for the device |
| `mac` | string | MAC address of the device (most reliable) |
| `ip` | string | IP address of the device |
| `hostname` | string | Hostname of the device |
| `minTrafficAmount` | number | Minimum traffic in KB over 15 minutes to consider device active |

### WiFi Point Configuration

| Option | Type | Description |
|--------|------|-------------|
| `name` | string | Room/location name for the sensor |
| `mac` | string | MAC address of the access point |
| `ip` | string | IP address of the access point |

## Device Identification

The plugin identifies devices using the following priority:

1. **MAC Address** - Most reliable, matches exact device
2. **IP Address** - Good for devices with static IPs
3. **Hostname** - Useful for named devices

If multiple identifiers are provided, ALL must match for positive identification.

## Traffic Monitoring

Set `minTrafficAmount` (in KB per 15 minutes) to ensure devices are actively being used:

- **Unset/0**: Any connection counts as presence
- **50-100 KB**: Light activity (notifications, background sync)
- **500+ KB**: Active usage (browsing, streaming)

*Note: Traffic monitoring only works with local controller API, not Site Manager API.*

## HomeKit Integration

The plugin creates the following accessories in HomeKit:

- **Global Presence** - Occupancy sensor showing if any resident is home
- **[Room Name] Presence** - Occupancy sensor for each configured WiFi point

These appear as standard occupancy sensors and can be used in HomeKit automations.

## Automation Examples

### Welcome Home Automation
```
When: Global Presence detects occupancy
Action: Turn on lights, adjust thermostat, disarm security
```

### Room-Based Lighting
```
When: Living Room Presence detects occupancy
Action: Turn on living room lights
When: Living Room Presence detects no occupancy (after 5 minutes)
Action: Turn off living room lights
```

### Security Integration
```
When: Global Presence detects no occupancy (after 30 minutes)
Action: Arm security system, set away mode
```

## Troubleshooting

### No Devices Detected
- Verify MAC addresses in UniFi controller match configuration
- Check that devices are connected to WiFi (not ethernet)
- Ensure API key has proper permissions

### Site Manager API Issues
- Verify Host ID is correct
- Check API key permissions in UniFi Cloud Console
- Ensure `useSiteManagerApi` is set to `true`

### WiFi Points Not Working
- Verify access point MAC addresses or IP addresses
- Check that access points are online and managed
- Ensure access point naming is consistent

### Traffic Monitoring Not Working
- Feature only available with local controller API
- Check that controller firmware supports traffic statistics
- Reduce `minTrafficAmount` threshold for testing

## API Compatibility

| Feature | Local Controller | Site Manager API |
|---------|------------------|-------------------|
| Device presence detection | ✅ | ✅ |
| Traffic monitoring | ✅ | ❌ |
| WiFi point identification | ✅ | ✅ |
| Real-time updates | ✅ | ✅ |

## Contributing

Contributions are welcome! Please read our contributing guidelines and submit pull requests to our GitHub repository.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Credits

Based on [homebridge-unifi-occupancy](https://github.com/DouweM/homebridge-unifi-occupancy) by DouweM.  
Simplified and modernized for API token authentication and resident-based tracking.

## Support

- 🐛 [Report Issues](https://github.com/your-username/homebridge-unifi-occupancy-lite/issues)
- 💬 [Homebridge Discord](https://discord.gg/homebridge)
- 📖 [Homebridge Wiki](https://github.com/homebridge/homebridge/wiki)

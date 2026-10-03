// GENERATED FILE - DO NOT EDIT.
// Source: protocol/ble-file-v1.json
// Regenerate: node scripts/gen-protocol.mjs
#pragma once

#define SZ_BLE_FRAME_SIZE 244
#define SZ_BLE_HEADER_SIZE 4
#define SZ_BLE_PAYLOAD_SIZE 240
#define SZ_BLE_ACK_BLOCK 32
#define SZ_BLE_WINDOW 128
#define SZ_BLE_NOTIFY_MS 4
#define SZ_BLE_ACK_TIMEOUT_MS 500
#define SZ_BLE_ACK_RETRY 3
#define SZ_BLE_INPUT_CHUNK 512
#define SZ_BLE_LIST_MAX 12
#define SZ_FREQ_MIN_HZ 600
#define SZ_FREQ_MAX_HZ 1500
#define SZ_FREQ_STEP_HZ 25
#define SZ_FREQ_SHORT_DEFAULT 880
#define SZ_FREQ_LONG_DEFAULT 1100
#define SZ_VOL_LOW_DEFAULT 20
#define SZ_VOL_HIGH_DEFAULT 70
#define SZ_BEEP_SHORT_MIN_MS 20
#define SZ_BEEP_SHORT_MAX_MS 200
#define SZ_BEEP_SHORT_STEP_MS 5
#define SZ_BEEP_SHORT_DEFAULT_MS 56
#define SZ_BEEP_LONG_MIN_MS 40
#define SZ_BEEP_LONG_MAX_MS 500
#define SZ_BEEP_LONG_STEP_MS 5
#define SZ_BEEP_LONG_DEFAULT_MS 140
#define SZ_BEEP_GAP_MIN_MS 0
#define SZ_BEEP_GAP_MAX_MS 500
#define SZ_BEEP_GAP_STEP_MS 5
#define SZ_BEEP_GAP_DEFAULT_MS 60
#define SZ_BEEP_INTERVAL_MIN_MS 100
#define SZ_BEEP_INTERVAL_MAX_MS 5000
#define SZ_BEEP_INTERVAL_STEP_MS 50
#define SZ_BEEP_INTERVAL_DEFAULT_MS 1000
#define SZ_BEEP_MIN_KMH_MIN 60
#define SZ_BEEP_MIN_KMH_MAX 120
#define SZ_BEEP_MIN_KMH_STEP 1
#define SZ_BEEP_MIN_KMH_DEFAULT 60
#define SZ_VOL_LOW_KMH 60.0f
#define SZ_VOL_HIGH_KMH 120.0f

#define SZ_WIRE_PROTO "szusownik/ble-file-v1"
#define SZ_BLE_NAME "Szusownik"
#define SZ_CSV_HEADER "timestamp,lat,lon,speed,altitude_gps,heading,altitude_baro,gnss_fix_valid,gnss_fix_age_ms,gnss_satellites,gnss_satellites_age_ms,gnss_hdop,gnss_hdop_age_ms"
#define SZ_CSV_META_SUFFIX ".meta"
#define SZ_UUID_SVC "3f9a0001-7c4e-4b2a-9e11-000000000001"
#define SZ_UUID_INFO "3f9a0002-7c4e-4b2a-9e11-000000000002"
#define SZ_UUID_CTRL "3f9a0003-7c4e-4b2a-9e11-000000000003"
#define SZ_UUID_DATA "3f9a0004-7c4e-4b2a-9e11-000000000004"
#define SZ_UUID_STAT "3f9a0005-7c4e-4b2a-9e11-000000000005"
#define SZ_CMD_LIST "LIST:"
#define SZ_CMD_ROTATE "ROTATE"
#define SZ_CMD_DRYRUN "DRYRUN:"
#define SZ_CMD_START_FILE "START_FILE:"
#define SZ_CMD_STOP "STOP"
#define SZ_CMD_ACK "ACK:"
#define SZ_CMD_NACK "NACK:"
#define SZ_CMD_SETVOL_LOW "SETVOL:LOW:"
#define SZ_CMD_SETVOL_HIGH "SETVOL:HIGH:"
#define SZ_CMD_SETFREQ_SHORT "SETFREQ:SHORT:"
#define SZ_CMD_SETFREQ_LONG "SETFREQ:LONG:"
#define SZ_CMD_SETTIMING_SHORT "SETTIMING:SHORT:"
#define SZ_CMD_SETTIMING_LONG "SETTIMING:LONG:"
#define SZ_CMD_SETTIMING_GAP "SETTIMING:GAP:"
#define SZ_CMD_SETTIMING_INTERVAL "SETTIMING:INTERVAL:"
#define SZ_CMD_SETMINBEEP "SETMINBEEP:"
#define SZ_ST_LIST "list "
#define SZ_ST_OK "ok"
#define SZ_ST_STREAMING "streaming "
#define SZ_ST_DONE "done "
#define SZ_ST_DRYRUN "dryrun "
#define SZ_ST_ERR "err:"
#define SZ_ERR_OPEN "err:open"
#define SZ_ERR_READ "err:read"
#define SZ_ERR_DEFLATE "err:deflate"
#define SZ_ERR_ACK_TIMEOUT "err:ack-timeout"
#define SZ_ERR_BUSY "err:busy"
#define SZ_ERR_NO_STORAGE "err:no-storage"
#define SZ_ERR_NOMEM "err:nomem"
#define SZ_ERR_NO_BEEPER "err:no-beeper"

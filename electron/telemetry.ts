import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { app } from 'electron'
import * as fs from 'node:fs'
import * as path from 'node:path'

const execFileAsync = promisify(execFile)

export interface AppInfo {
  id: string
  name: string
  category: string
  color: string
}

export interface UsageEntry {
  date: string
  appId: string
  minutes: number
  seconds?: number  // Total seconds for more accurate display
  notifications: number
}

interface ActiveAppSample {
  process: string
  title: string
  isMinimized: boolean
  isVisible: boolean
}

interface UsageTracker {
  apps: AppInfo[]
  getSnapshot: () => {
    apps: AppInfo[]
    usageEntries: UsageEntry[]
    activeAppId: string | null
    runningApps: RunningAppSummary[]
  }
  clearData: () => void
  dispose: () => void
}

export interface RunningAppSummary {
  process: string
  appId: string
  count: number
  hasWindow: boolean
}

type CatalogGroup = {
  category: AppInfo['category']
  apps: Array<Pick<AppInfo, 'id' | 'name' | 'color'>>
}

// Extended app catalog grouped by category
const appCatalogGroups: CatalogGroup[] = [
  {
    category: 'Productivity',
    apps: [
      { id: 'code', name: 'VS Code', color: '#35a7ff' },
      { id: 'vscode-insiders', name: 'VS Code Insiders', color: '#24bfa5' },
      { id: 'visualstudio', name: 'Visual Studio', color: '#7c3aed' },
      { id: 'cursor', name: 'Cursor', color: '#00d4ff' },
      { id: 'pycharm', name: 'PyCharm', color: '#22c55e' },
      { id: 'notion', name: 'Notion', color: '#1f1f1f' },
      { id: 'notepad', name: 'Notepad', color: '#a0c4ff' },
      { id: 'notepad3', name: 'Notepad3', color: '#64748b' },
      { id: 'terminal', name: 'Terminal', color: '#4ec9b0' },
      { id: 'gitbash', name: 'Git Bash', color: '#f97316' },
      { id: 'word', name: 'Microsoft Word', color: '#2b579a' },
      { id: 'excel', name: 'Microsoft Excel', color: '#217346' },
      { id: 'powerpoint', name: 'PowerPoint', color: '#d24726' },
      { id: 'autocad', name: 'AutoCAD', color: '#ef4444' },
      { id: 'figma', name: 'Figma', color: '#f24e1e' },
      { id: 'photoshop', name: 'Photoshop', color: '#31a8ff' },
      { id: 'lightroom', name: 'Adobe Lightroom', color: '#0ea5e9' },
      { id: 'aftereffects', name: 'After Effects', color: '#6366f1' },
      { id: 'audition', name: 'Adobe Audition', color: '#8b5cf6' },
      { id: 'premiere', name: 'Premiere Pro', color: '#9999ff' },
      { id: 'blender', name: 'Blender', color: '#f5792a' },
      { id: 'obs', name: 'OBS Studio', color: '#302e2e' },
      { id: 'fontforge', name: 'FontForge', color: '#64748b' },
      { id: 'github', name: 'GitHub Desktop', color: '#6e5494' },
      { id: 'postman', name: 'Postman', color: '#ff6c37' },
      { id: 'rider', name: 'JetBrains Rider', color: '#c90f5e' },
      { id: 'intellij', name: 'IntelliJ IDEA', color: '#fe315d' },
      { id: 'webstorm', name: 'WebStorm', color: '#07c3f2' },
      { id: 'wps', name: 'WPS Office', color: '#ef4444' },
      { id: 'typora', name: 'Typora', color: '#64748b' },
      { id: 'xmind', name: 'XMind', color: '#f97316' },
    ],
  },
  {
    category: 'Browsers',
    apps: [
      { id: 'msedge', name: 'Microsoft Edge', color: '#4f8bff' },
      { id: 'chrome', name: 'Google Chrome', color: '#f7b955' },
      { id: 'firefox', name: 'Firefox', color: '#ff6611' },
      { id: 'zen', name: 'Zen Browser', color: '#8b5cf6' },
      { id: 'brave', name: 'Brave', color: '#fb542b' },
      { id: 'opera', name: 'Opera', color: '#ff1b2d' },
      { id: 'vivaldi', name: 'Vivaldi', color: '#ef3939' },
      { id: 'arc', name: 'Arc', color: '#5e5ce6' },
      { id: 'qqbrowser', name: 'QQ Browser', color: '#3b82f6' },
      { id: 'se360', name: '360 Secure Browser', color: '#22c55e' },
      { id: 'chrome360', name: '360 Extreme Browser', color: '#16a34a' },
      { id: 'sogou', name: 'Sogou Explorer', color: '#f59e0b' },
    ],
  },
  {
    category: 'Communication',
    apps: [
      { id: 'teams', name: 'Microsoft Teams', color: '#5b7cfa' },
      { id: 'outlook', name: 'Outlook', color: '#2f6fff' },
      { id: 'slack', name: 'Slack', color: '#e91e63' },
      { id: 'zoom', name: 'Zoom', color: '#2d8cff' },
      { id: 'wechat', name: 'WeChat', color: '#22c55e' },
      { id: 'qq', name: 'QQ', color: '#06b6d4' },
      { id: 'dingtalk', name: 'DingTalk', color: '#1677ff' },
      { id: 'feishu', name: 'Feishu', color: '#14b8a6' },
      { id: 'wecom', name: 'WeCom', color: '#0284c7' },
      { id: 'kook', name: 'KOOK', color: '#22c55e' },
      { id: 'teamspeak', name: 'TeamSpeak', color: '#3b82f6' },
    ],
  },
  {
    category: 'Social',
    apps: [
      { id: 'discord', name: 'Discord', color: '#8c7dff' },
      { id: 'whatsapp', name: 'WhatsApp', color: '#25d366' },
      { id: 'telegram', name: 'Telegram', color: '#0088cc' },
    ],
  },
  {
    category: 'Entertainment',
    apps: [
      { id: 'spotify', name: 'Spotify', color: '#2ed47a' },
      { id: 'vlc', name: 'VLC', color: '#ff8c00' },
      { id: 'mpv', name: 'mpv', color: '#7c3aed' },
      { id: 'youtube', name: 'YouTube', color: '#ff0000' },
      { id: 'netflix', name: 'Netflix', color: '#e50914' },
      { id: 'bilibili', name: 'Bilibili', color: '#f472b6' },
      { id: 'douyin', name: 'Douyin', color: '#111827' },
      { id: 'iqiyi', name: 'iQIYI', color: '#16a34a' },
      { id: 'tencentvideo', name: 'Tencent Video', color: '#10b981' },
      { id: 'youku', name: 'Youku', color: '#ef4444' },
      { id: 'cloudmusic', name: 'NetEase Cloud Music', color: '#dc2626' },
      { id: 'qqmusic', name: 'QQ Music', color: '#22c55e' },
    ],
  },
  {
    category: 'Utilities',
    apps: [
      { id: 'explorer', name: 'File Explorer', color: '#9aa0ff' },
      { id: 'localsend', name: 'LocalSend', color: '#06b6d4' },
      { id: 'todesk', name: 'ToDesk', color: '#0ea5e9' },
      { id: 'moonlight', name: 'Moonlight', color: '#38bdf8' },
      { id: 'everything', name: 'Everything', color: '#f59e0b' },
      { id: 'bandizip', name: 'Bandizip', color: '#3b82f6' },
      { id: 'idm', name: 'Internet Download Manager', color: '#1d4ed8' },
      { id: 'fdm', name: 'Free Download Manager', color: '#0284c7' },
      { id: 'treesize', name: 'TreeSize', color: '#16a34a' },
      { id: 'wisecare365', name: 'Wise Care 365', color: '#2563eb' },
      { id: 'watttoolkit', name: 'Watt Toolkit', color: '#06b6d4' },
      { id: 'steamtools', name: 'SteamTools', color: '#334155' },
      { id: 'msi-afterburner', name: 'MSI Afterburner', color: '#ef4444' },
      { id: 'handbrake', name: 'HandBrake', color: '#22c55e' },
      { id: 'clash-verge', name: 'Clash Verge', color: '#a855f7' },
      { id: 'xshell', name: 'Xshell', color: '#f97316' },
      { id: 'xftp', name: 'Xftp', color: '#fb923c' },
      { id: 'baidunetdisk', name: 'Baidu Netdisk', color: '#2563eb' },
      { id: 'xunlei', name: 'Xunlei', color: '#eab308' },
    ],
  },
  {
    category: 'Games',
    apps: [
      { id: 'steam', name: 'Steam', color: '#ff8b6a' },
      { id: 'epicgames', name: 'Epic Games Launcher', color: '#111827' },
      { id: 'ubisoftconnect', name: 'Ubisoft Connect', color: '#2563eb' },
      { id: 'eadesktop', name: 'EA App', color: '#f97316' },
      { id: 'rockstar', name: 'Rockstar Games Launcher', color: '#facc15' },
      { id: 'pcl', name: 'PCL Launcher', color: '#0ea5e9' },
      { id: 'perfectworld', name: 'Perfect World Platform', color: '#64748b' },
      { id: 'fivee', name: '5E Platform', color: '#7c3aed' },
      { id: 'leigod', name: 'Leigod Booster', color: '#ef4444' },
      { id: 'uugame', name: 'UU Booster', color: '#0284c7' },
      { id: 'balatro', name: 'Balatro', color: '#f97316' },
      { id: 'stardewvalley', name: 'Stardew Valley', color: '#84cc16' },
      { id: 'osu', name: 'osu!', color: '#ec4899' },
      { id: 'deltaforce', name: 'Delta Force', color: '#10b981' },
      { id: 'forzahorizon5', name: 'Forza Horizon 5', color: '#f59e0b' },
      { id: 'rainbowsix', name: "Tom Clancy's Rainbow Six Siege", color: '#2563eb' },
      { id: 'warthunder', name: 'War Thunder', color: '#dc2626' },
      { id: 'readyornot', name: 'Ready or Not', color: '#374151' },
      { id: 'houseflipper2', name: 'House Flipper 2', color: '#0ea5e9' },
      { id: 'eurotruck2', name: 'Euro Truck Simulator 2', color: '#475569' },
      { id: 'coffeetalk', name: 'Coffee Talk', color: '#a16207' },
    ],
  },
]

const appCatalog: AppInfo[] = appCatalogGroups.flatMap(({ category, apps }) =>
  apps.map((app) => ({ ...app, category }))
)

// Map process names to app IDs (case-insensitive matching)
const processPatterns: Array<{ pattern: RegExp; appId: string }> = [
  // Productivity
  { pattern: /^code$/i, appId: 'code' },
  { pattern: /^code - insiders$/i, appId: 'vscode-insiders' },
  { pattern: /^devenv$/i, appId: 'visualstudio' },
  { pattern: /^cursor$/i, appId: 'cursor' },
  { pattern: /^pycharm64$/i, appId: 'pycharm' },
  { pattern: /^pycharm$/i, appId: 'pycharm' },
  { pattern: /^notepad$/i, appId: 'notepad' },
  { pattern: /^notepad3$/i, appId: 'notepad3' },
  { pattern: /^notepad\+\+$/i, appId: 'notepad' },
  { pattern: /^windowsterminal$/i, appId: 'terminal' },
  { pattern: /^wt$/i, appId: 'terminal' },
  { pattern: /^powershell$/i, appId: 'terminal' },
  { pattern: /^cmd$/i, appId: 'terminal' },
  { pattern: /^git-bash$/i, appId: 'gitbash' },
  { pattern: /^notion$/i, appId: 'notion' },
  { pattern: /^winword$/i, appId: 'word' },
  { pattern: /^excel$/i, appId: 'excel' },
  { pattern: /^powerpnt$/i, appId: 'powerpoint' },
  { pattern: /^acad$/i, appId: 'autocad' },
  { pattern: /^obs64$/i, appId: 'obs' },
  { pattern: /^obs$/i, appId: 'obs' },
  { pattern: /^figma$/i, appId: 'figma' },
  { pattern: /^photoshop$/i, appId: 'photoshop' },
  { pattern: /^lightroomclassic$/i, appId: 'lightroom' },
  { pattern: /^afterfx$/i, appId: 'aftereffects' },
  { pattern: /^adobe audition/i, appId: 'audition' },
  { pattern: /^audition$/i, appId: 'audition' },
  { pattern: /^premiere/i, appId: 'premiere' },
  { pattern: /^blender$/i, appId: 'blender' },
  { pattern: /^fontforge$/i, appId: 'fontforge' },
  { pattern: /^githubdesktop$/i, appId: 'github' },
  { pattern: /^postman$/i, appId: 'postman' },
  { pattern: /^rider64$/i, appId: 'rider' },
  { pattern: /^idea64$/i, appId: 'intellij' },
  { pattern: /^webstorm64$/i, appId: 'webstorm' },
  { pattern: /^wps$/i, appId: 'wps' },
  { pattern: /^et$/i, appId: 'wps' },
  { pattern: /^wpp$/i, appId: 'wps' },
  { pattern: /^typora$/i, appId: 'typora' },
  { pattern: /^xmind$/i, appId: 'xmind' },

  // Browsers
  { pattern: /^msedge$/i, appId: 'msedge' },
  { pattern: /^chrome$/i, appId: 'chrome' },
  { pattern: /^firefox$/i, appId: 'firefox' },
  { pattern: /^zen$/i, appId: 'zen' },
  { pattern: /^brave$/i, appId: 'brave' },
  { pattern: /^opera$/i, appId: 'opera' },
  { pattern: /^vivaldi$/i, appId: 'vivaldi' },
  { pattern: /^arc$/i, appId: 'arc' },
  { pattern: /^qqbrowser$/i, appId: 'qqbrowser' },
  { pattern: /^360se$/i, appId: 'se360' },
  { pattern: /^360chrome$/i, appId: 'chrome360' },
  { pattern: /^sogouexplorer$/i, appId: 'sogou' },

  // Communication
  { pattern: /^teams$/i, appId: 'teams' },
  { pattern: /^ms-teams$/i, appId: 'teams' },
  { pattern: /^outlook$/i, appId: 'outlook' },
  { pattern: /^slack$/i, appId: 'slack' },
  { pattern: /^zoom$/i, appId: 'zoom' },
  { pattern: /^wechat$/i, appId: 'wechat' },
  { pattern: /^qq$/i, appId: 'qq' },
  { pattern: /^dingtalk$/i, appId: 'dingtalk' },
  { pattern: /^feishu$/i, appId: 'feishu' },
  { pattern: /^lark$/i, appId: 'feishu' },
  { pattern: /^wxwork$/i, appId: 'wecom' },
  { pattern: /^wecom$/i, appId: 'wecom' },
  { pattern: /^kook$/i, appId: 'kook' },
  { pattern: /^ts3client$/i, appId: 'teamspeak' },
  { pattern: /^teamspeak$/i, appId: 'teamspeak' },

  // Social
  { pattern: /^discord$/i, appId: 'discord' },
  { pattern: /^whatsapp\.root$/i, appId: 'whatsapp' },
  { pattern: /^whatsapp$/i, appId: 'whatsapp' },
  { pattern: /^telegram$/i, appId: 'telegram' },

  // Entertainment
  { pattern: /^spotify$/i, appId: 'spotify' },
  { pattern: /^vlc$/i, appId: 'vlc' },
  { pattern: /^mpv$/i, appId: 'mpv' },
  { pattern: /^bilibili$/i, appId: 'bilibili' },
  { pattern: /^douyin$/i, appId: 'douyin' },
  { pattern: /^iqiyi$/i, appId: 'iqiyi' },
  { pattern: /^qqlive$/i, appId: 'tencentvideo' },
  { pattern: /^youku$/i, appId: 'youku' },
  { pattern: /^cloudmusic$/i, appId: 'cloudmusic' },
  { pattern: /^qqmusic$/i, appId: 'qqmusic' },

  // Utilities
  { pattern: /^explorer$/i, appId: 'explorer' },
  { pattern: /^localsend$/i, appId: 'localsend' },
  { pattern: /^todesk$/i, appId: 'todesk' },
  { pattern: /^moonlight$/i, appId: 'moonlight' },
  { pattern: /^everything$/i, appId: 'everything' },
  { pattern: /^bandizip$/i, appId: 'bandizip' },
  { pattern: /^idman$/i, appId: 'idm' },
  { pattern: /^fdm$/i, appId: 'fdm' },
  { pattern: /^treesize$/i, appId: 'treesize' },
  { pattern: /^wisecare365$/i, appId: 'wisecare365' },
  { pattern: /^watttoolkit$/i, appId: 'watttoolkit' },
  { pattern: /^steamtools$/i, appId: 'steamtools' },
  { pattern: /^msiafterburner$/i, appId: 'msi-afterburner' },
  { pattern: /^handbrake$/i, appId: 'handbrake' },
  { pattern: /^clash-verge$/i, appId: 'clash-verge' },
  { pattern: /^clashverge$/i, appId: 'clash-verge' },
  { pattern: /^xshell$/i, appId: 'xshell' },
  { pattern: /^xftp$/i, appId: 'xftp' },
  { pattern: /^baidunetdisk$/i, appId: 'baidunetdisk' },
  { pattern: /^xunlei$/i, appId: 'xunlei' },

  // Games
  { pattern: /^steam$/i, appId: 'steam' },
  { pattern: /^steamwebhelper$/i, appId: 'steam' },
  { pattern: /^epicgameslauncher$/i, appId: 'epicgames' },
  { pattern: /^ubisoftconnect$/i, appId: 'ubisoftconnect' },
  { pattern: /^eadesktop$/i, appId: 'eadesktop' },
  { pattern: /^rockstar.*launcher$/i, appId: 'rockstar' },
  { pattern: /^pcl2$/i, appId: 'pcl' },
  { pattern: /^pcl$/i, appId: 'pcl' },
  { pattern: /^perfectworld.*platform$/i, appId: 'perfectworld' },
  { pattern: /^5eclient$/i, appId: 'fivee' },
  { pattern: /^leigod$/i, appId: 'leigod' },
  { pattern: /^uu$/i, appId: 'uugame' },
  { pattern: /^uugamebooster$/i, appId: 'uugame' },
  { pattern: /^balatro$/i, appId: 'balatro' },
  { pattern: /^stardew valley$/i, appId: 'stardewvalley' },
  { pattern: /^stardewvalley$/i, appId: 'stardewvalley' },
  { pattern: /^osu!?$/i, appId: 'osu' },
  { pattern: /^delta.*force/i, appId: 'deltaforce' },
  { pattern: /^forzahorizon5$/i, appId: 'forzahorizon5' },
  { pattern: /^rainbowsix$/i, appId: 'rainbowsix' },
  { pattern: /^rainbow.*six/i, appId: 'rainbowsix' },
  { pattern: /^aces$/i, appId: 'warthunder' },
  { pattern: /^warthunder$/i, appId: 'warthunder' },
  { pattern: /^readyornot/i, appId: 'readyornot' },
  { pattern: /^houseflipper2$/i, appId: 'houseflipper2' },
  { pattern: /^eurotrucks2$/i, appId: 'eurotruck2' },
  { pattern: /^coffeetalk$/i, appId: 'coffeetalk' },
]

const unknownApp: AppInfo = {
  id: 'other',
  name: 'Other apps',
  category: 'Other',
  color: '#6b7280',
}

// Get today's date in Windows local timezone (consistent with main.ts and frontend)
const getTodayDateString = (): string => {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const toDisplayName = (value: string) =>
  value
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())

const getDataPath = () => {
  const userDataPath = app.getPath('userData')
  return path.join(userDataPath, 'usage-data.json')
}

const loadPersistedData = (): Map<string, number> => {
  const dataPath = getDataPath()
  const map = new Map<string, number>()
  
  try {
    if (fs.existsSync(dataPath)) {
      const raw = fs.readFileSync(dataPath, 'utf8')
      const data = JSON.parse(raw) as Record<string, number>
      for (const [key, value] of Object.entries(data)) {
        map.set(key, value)
      }
    }
  } catch {
    // Ignore load errors, start fresh
  }
  
  return map
}

const savePersistedData = (totals: Map<string, number>) => {
  const dataPath = getDataPath()
  const data: Record<string, number> = {}
  
  for (const [key, value] of totals.entries()) {
    data[key] = value
  }
  
  try {
    const dir = path.dirname(dataPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(dataPath, JSON.stringify(data, null, 2))
  } catch {
    // Ignore save errors
  }
}

const getActiveApp = async (): Promise<ActiveAppSample | null> => {
  // Simpler, more reliable PowerShell script for getting foreground window
  const script = `
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class ForegroundWindow {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Auto)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll", SetLastError=true)] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
}
'@
$hWnd = [ForegroundWindow]::GetForegroundWindow()
if ($hWnd -eq [IntPtr]::Zero) {
  Write-Output '{"process":null,"title":null,"isMinimized":false,"isVisible":true}'
  exit
}
$procId = 0
[ForegroundWindow]::GetWindowThreadProcessId($hWnd, [ref]$procId) | Out-Null
$proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
$sb = New-Object System.Text.StringBuilder 512
[ForegroundWindow]::GetWindowText($hWnd, $sb, $sb.Capacity) | Out-Null
$title = $sb.ToString()
$name = if ($proc) { $proc.ProcessName } else { $null }
@{ process=$name; title=$title; isMinimized=$false; isVisible=$true } | ConvertTo-Json -Compress
`

  try {
    const { stdout } = await execFileAsync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-WindowStyle',
        'Hidden',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        script,
      ],
      {
        windowsHide: true,
        timeout: 3000,
        maxBuffer: 1024 * 1024,
      }
    )

    const raw = (stdout ?? '').trim()
    if (!raw) return null
    const parsed = JSON.parse(raw) as ActiveAppSample
    if (!parsed?.process) return null
    return parsed
  } catch {
    return null
  }
}

const getRunningApps = async (): Promise<Array<{ process: string; count: number; hasWindow: boolean }>> => {
  if (process.platform !== 'win32') return []

  const script = `
$ignored = @(
  'Idle','System','Registry','smss','csrss','wininit','services','lsass','svchost','fontdrvhost',
  'dwm','winlogon','conhost','dllhost','taskhostw','spoolsv','RuntimeBroker','SearchIndexer',
  'SecurityHealthService','WmiPrvSE','sihost','audiodg','ctfmon','SearchHost','StartMenuExperienceHost',
  'ShellExperienceHost','TextInputHost','LockApp','ApplicationFrameHost','SystemSettings',
  'WidgetService','Widgets','PhoneExperienceHost','UserOOBEBroker','CredentialUIBroker'
)

$procs = Get-Process -ErrorAction SilentlyContinue |
  Where-Object { $_.ProcessName -and ($ignored -notcontains $_.ProcessName) } |
  Select-Object ProcessName, MainWindowHandle, MainWindowTitle

$groups = $procs | Group-Object ProcessName | ForEach-Object {
  $hasWindow = ($_.Group | Where-Object { 
    $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -and $_.MainWindowTitle.Trim().Length -gt 0 
  } | Measure-Object).Count -gt 0
  [PSCustomObject]@{ process=$_.Name; count=$_.Count; hasWindow=$hasWindow }
}

$sorted = $groups | Sort-Object @{Expression={$_.hasWindow}; Descending=$true}, @{Expression={$_.count}; Descending=$true}
$result = $sorted | Select-Object -First 80
if ($result -eq $null) {
  Write-Output '[]'
} elseif ($result -is [array]) {
  $result | ConvertTo-Json -Compress
} else {
  ConvertTo-Json @($result) -Compress
}
`

  try {
    const { stdout } = await execFileAsync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-WindowStyle',
        'Hidden',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        script,
      ],
      {
        windowsHide: true,
        timeout: 4000,
        maxBuffer: 4 * 1024 * 1024,
      }
    )

    const raw = (stdout ?? '').trim()
    if (!raw) return []
    const parsed = JSON.parse(raw) as
      | Array<{ process: string; count: number; hasWindow: boolean }>
      | { process: string; count: number; hasWindow: boolean }

    return Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    return []
  }
}

const mapProcessToAppId = (processName: string): string | null => {
  for (const { pattern, appId } of processPatterns) {
    if (pattern.test(processName)) {
      return appId
    }
  }
  return null
}

export const createUsageTracker = (): UsageTracker => {
  const appLookup = new Map<string, AppInfo>()
  for (const app of appCatalog) {
    appLookup.set(app.id, app)
  }
  appLookup.set(unknownApp.id, unknownApp)

  const ensureDynamicAppInfo = (appId: string, nameHint?: string) => {
    if (!appId || appLookup.has(appId)) return
    const rawName = nameHint ?? (appId.startsWith('proc:') ? appId.slice(5) : appId)
    appLookup.set(appId, {
      id: appId,
      name: toDisplayName(rawName),
      category: 'Other',
      color: '#6b7280',
    })
  }

  // Load persisted data
  const totals = loadPersistedData()
  
  let interval: NodeJS.Timeout | null = null
  let saveInterval: NodeJS.Timeout | null = null
  const tickMs = 1000
  let lastAppId: string | null = null
  let lastTimestamp = Date.now()
  let activeAppId: string | null = null
  let runningApps: RunningAppSummary[] = []

  const record = (appId: string | null, deltaSeconds: number) => {
    if (!appId || deltaSeconds <= 0) return
    const today = getTodayDateString()
    const key = `${today}:${appId}`
    totals.set(key, (totals.get(key) ?? 0) + deltaSeconds)
  }

  const resolveAppId = (active: ActiveAppSample | null): string | null => {
    if (!active?.process) return null
    
    // Skip tracking the ScreenForge app itself or Electron
    const processLower = active.process.toLowerCase()
    if (processLower === 'electron' || processLower === 'screenforge' || 
        active.title?.toLowerCase().includes('screenforge')) {
      return null
    }
    
    const mapped = mapProcessToAppId(active.process)
    if (mapped && appLookup.has(mapped)) return mapped
    const dynamicId = `proc:${active.process.toLowerCase()}`
    ensureDynamicAppInfo(dynamicId, active.process)
    return dynamicId
  }

  // Separate function for running apps that doesn't require visibility check
  const resolveAppIdForRunningApps = (processName: string): string | null => {
    if (!processName) return null
    
    const processLower = processName.toLowerCase()
    if (processLower === 'electron' || processLower === 'screenforge') {
      return null
    }
    
    const mapped = mapProcessToAppId(processName)
    if (mapped && appLookup.has(mapped)) return mapped
    const dynamicId = `proc:${processName.toLowerCase()}`
    ensureDynamicAppInfo(dynamicId, processName)
    return dynamicId
  }

  const refreshRunningApps = async () => {
    const raw = await getRunningApps()
    runningApps = raw
      .filter((p) => Boolean(p.process))
      .map((p) => {
        const appId = resolveAppIdForRunningApps(p.process)
        return { process: p.process, appId, count: p.count, hasWindow: p.hasWindow }
      })
      .filter((p): p is RunningAppSummary => p.appId !== null)
  }

  const poll = async () => {
    const now = Date.now()
    const elapsedSeconds = Math.max(0, (now - lastTimestamp) / 1000)
    lastTimestamp = now

    // Record time for the previous app
    // Cap at 60 seconds to avoid huge jumps if the app was suspended
    if (lastAppId && elapsedSeconds > 0) {
      const cappedSeconds = Math.min(elapsedSeconds, 60)
      record(lastAppId, cappedSeconds)
    }

    const active = await getActiveApp()
    activeAppId = resolveAppId(active)
    lastAppId = activeAppId
  }

  // Start polling
  interval = setInterval(poll, tickMs)
  // Initialize immediately
  poll()

  // Refresh running apps periodically (every 5 seconds for better responsiveness)
  const runningAppsInterval = setInterval(() => {
    refreshRunningApps()
  }, 5000)
  refreshRunningApps()

  // Save data every 30 seconds
  saveInterval = setInterval(() => {
    savePersistedData(totals)
  }, 30000)

  return {
    apps: Array.from(appLookup.values()),
    getSnapshot: () => {
      const entries: UsageEntry[] = []
      const usedAppIds = new Set<string>()
      
      for (const [key, seconds] of totals.entries()) {
        // Key format is "YYYY-MM-DD:appId" where appId can contain colons (e.g., "proc:chrome")
        const firstColonIndex = key.indexOf(':')
        if (firstColonIndex === -1) continue
        const date = key.slice(0, firstColonIndex)
        const appId = key.slice(firstColonIndex + 1)
        if (!appId) continue
        ensureDynamicAppInfo(appId)
        usedAppIds.add(appId)
        entries.push({
          date,
          appId,
          // Use floor to ensure we don't over-report, but keep fractional for accuracy
          minutes: Math.max(0, Math.floor(seconds / 60)),
          seconds: Math.max(0, Math.floor(seconds)),  // Include raw seconds for accurate display
          notifications: 0,
        })
      }

      // Only return apps that have been used
      const apps = Array.from(appLookup.values()).filter(
        (app) => usedAppIds.has(app.id)
      )

      return { apps, usageEntries: entries, activeAppId, runningApps }
    },
    clearData: () => {
      totals.clear()
      savePersistedData(totals)
    },
    dispose: () => {
      if (interval) {
        clearInterval(interval)
        interval = null
      }
      if (saveInterval) {
        clearInterval(saveInterval)
        saveInterval = null
      }
      clearInterval(runningAppsInterval)
      // Save on dispose
      savePersistedData(totals)
    },
  }
}

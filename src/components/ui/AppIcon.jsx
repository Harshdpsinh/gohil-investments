import {
  Activity, ArchiveRestore, ArrowDownToLine, ArrowUp, BadgeIndianRupee,
  BarChart3, BriefcaseBusiness, Building2, Check, CheckCircle2,
  ChevronDown, ChevronLeft, ChevronRight, CircleAlert, CircleDollarSign,
  ClipboardList, Clock3, CloudDownload, CloudUpload,
  DatabaseBackup, Download, FileCheck2, FileClock, FilePenLine, FileSearch,
  FileSpreadsheet, FileText, FolderOpen, HeartPulse, History, House, KeyRound,
  LayoutDashboard, Lightbulb, LockKeyhole, LogOut, Mail, Menu, Merge,
  MessageCircle, Moon, MoreHorizontal, Pencil, Phone, Plus, RefreshCw,
  RotateCcw, Search, Settings2, ShieldCheck, Sparkles, Sun, Trash2, Upload,
  User, UserCog, UserRoundPlus, Users, UsersRound, WalletCards, X,
} from 'lucide-react'

const ICONS = {
  activity: Activity, archiveRestore: ArchiveRestore, arrowDown: ArrowDownToLine,
  arrowUp: ArrowUp, backup: DatabaseBackup, check: Check,
  checkCircle: CheckCircle2, chevronDown: ChevronDown, chevronLeft: ChevronLeft,
  chevronRight: ChevronRight, claims: FileSearch, client: User, clients: UsersRound,
  clock: Clock3, commission: CircleDollarSign, dashboard: LayoutDashboard,
  database: DatabaseBackup, download: Download, endorsements: FilePenLine,
  file: FileText, fileCheck: FileCheck2, fileClock: FileClock, folder: FolderOpen,
  health: HeartPulse, history: History, home: House, insurer: Building2,
  key: KeyRound, leads: Lightbulb, lock: LockKeyhole, logout: LogOut, mail: Mail,
  masters: Settings2, menu: Menu, merge: Merge, message: MessageCircle, moon: Moon,
  more: MoreHorizontal, pencil: Pencil, phone: Phone, plus: Plus,
  policies: WalletCards, proposals: ClipboardList, reconcile: RefreshCw,
  renewals: RotateCcw, reports: BarChart3, rupee: BadgeIndianRupee,
  search: Search, settings: Settings2, shield: ShieldCheck, sparkles: Sparkles,
  spreadsheet: FileSpreadsheet, staff: UserCog, sun: Sun,
  trash: Trash2, upload: Upload, uploadCloud: CloudUpload,
  downloadCloud: CloudDownload, userAdd: UserRoundPlus, users: Users,
  warning: CircleAlert, work: BriefcaseBusiness, x: X,
}

export default function AppIcon({ name, size = 18, strokeWidth = 1.9, className = '', ...props }) {
  const Icon = ICONS[name] || Activity
  return <Icon aria-hidden="true" className={className} size={size} strokeWidth={strokeWidth} {...props} />
}

export { ICONS }

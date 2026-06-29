import { useState, useEffect, useCallback, Component, ReactNode } from 'react';
import {
  Trash2,
  Edit2,
  Download,
  Upload,
  Plus,
  X,
  Check,
  AlertTriangle,
  Gamepad2,
  User,
  Package,
  Calendar,
  ChevronLeft,
  Star,
  Filter,
  Eye,
  EyeOff,
  Minus,
  Sparkles,
  Image as ImageIcon,
  Warehouse,
  Link2,
} from 'lucide-react';

// Error Boundary
export class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error?: Error }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-900 text-white p-8 flex flex-col items-center justify-center">
          <AlertTriangle className="w-16 h-16 text-red-500 mb-4" />
          <h1 className="text-2xl font-bold mb-2">Une erreur s'est produite</h1>
          <p className="text-slate-400 mb-4">{this.state.error?.message}</p>
          <button
            onClick={() => {
              localStorage.removeItem('gacha-farm-data');
              window.location.reload();
            }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg"
          >
            Reinitialiser les donnees
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Types
type Priority = 'high' | 'medium' | 'low';
type DayOfWeek = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun' | 'any';
type ViewType = 'dashboard' | 'games' | 'game-detail' | 'character-detail' | 'inventory';

interface Resource {
  id: string;
  name: string;
  type: string;
  icon: string;
  imageUrl?: string;
  needed: number;
  owned: number;
  farmLocation: string;
  daysAvailable: DayOfWeek[];
  isCompleted: boolean;
  energyCost: number;
  dropRate: number; // Percentage (e.g., 33 for 33%)
  inventoryItemId?: string;
  // Weekly runs
  weeklyRuns?: number; // Max runs per week
  runsDone?: number; // Runs done this week
  resetDay?: DayOfWeek; // Day when runs reset
  lastResetDate?: string; // ISO date of last reset
}

interface InventoryItem {
  id: string;
  name: string;
  type: string;
  icon: string;
  imageUrl?: string;
  owned: number;
  energyCost?: number;
  dropRate?: number;
  farmLocation?: string;
  daysAvailable?: DayOfWeek[];
  // Weekly run info (used when assigning to a character)
  weeklyRuns?: number;
  resetDay?: DayOfWeek;
}

interface ChecklistItem {
  id: string;
  text: string;
  isDone: boolean;
}

interface Checklist {
  id: string;
  title: string;
  items: ChecklistItem[];
}

interface Character {
  id: string;
  name: string;
  element: string;
  rarity: number;
  image: string;
  imageUrl?: string;
  priority: Priority;
  targetLevel: number;
  currentLevel: number;
  skills: string;
  resources: Resource[];
  checklists: Checklist[];
}

interface Game {
  id: string;
  name: string;
  icon: string;
  imageUrl?: string;
  color: string;
  characters: Character[];
  resourceTypes: string[];
  inventory: InventoryItem[];
  // Customization
  elements?: string[];       // List of playable elements/types (e.g. Pyro, Cryo...)
  energyName?: string;       // Name of the stamina/energy (e.g. Résine, Endurance...)
  currencyName?: string;     // Name of the main currency (e.g. Primogemmes, Astrite...)
}

interface AppData {
  version: string;
  games: Game[];
}

// Types de ressources par défaut
const defaultResourceTypes: string[] = [
  'Materiau',
  'Monnaie',
  'Drop de boss',
  'Boss hebdo',
  'Domaine',
  'Commun',
];

// Utility functions
const generateId = (): string => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

const getTodayDay = (): DayOfWeek => {
  const days: DayOfWeek[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  return days[new Date().getDay()];
};

// Priority order for allocation
const priorityOrder: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

// Calculate total needed for an inventory item across all characters (by inventoryItemId)
const getTotalNeededForItem = (game: Game, inventoryItemId: string): number => {
  let total = 0;
  game.characters.forEach(c => {
    c.resources.forEach(r => {
      if (r.inventoryItemId === inventoryItemId) {
        total += Math.max(0, r.needed);
      }
    });
  });
  return total;
};

// Calculate inventory allocation based on priority.
// Returns a map of "resourceId -> amount covered by inventory"
// Logic: inventory.owned is the single source of truth.
// resource.owned = quantity farmed directly (outside inventory).
// The inventory pool is distributed by character priority.
const calculateInventoryAllocation = (game: Game): Map<string, number> => {
  const allocation = new Map<string, number>();

  // Build inventory pool keyed by inventoryItemId
  const inventoryPool = new Map<string, number>();
  game.inventory.forEach(item => {
    inventoryPool.set(item.id, item.owned);
  });

  // Sort characters by priority then original order (stable)
  const sortedCharacters = [...game.characters].sort((a, b) => {
    const diff = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (diff !== 0) return diff;
    return game.characters.indexOf(a) - game.characters.indexOf(b);
  });

  sortedCharacters.forEach(character => {
    character.resources.forEach(resource => {
      if (!resource.inventoryItemId) return;
      // How much still needed after direct farm (resource.owned)
      const stillNeeded = Math.max(0, resource.needed - resource.owned);
      if (stillNeeded <= 0) return;

      const available = inventoryPool.get(resource.inventoryItemId) || 0;
      const allocate = Math.min(stillNeeded, available);
      if (allocate > 0) {
        allocation.set(resource.id, allocate);
        inventoryPool.set(resource.inventoryItemId, available - allocate);
      }
    });
  });

  return allocation;
};

// Get how much a character still needs to farm (after direct owned + inventory allocation)
const getRemainingToFarm = (
  resource: Resource,
  _game: Game,
  allocation: Map<string, number>
): number => {
  const needed = resource.needed - resource.owned;
  if (needed <= 0) return 0;
  const allocated = allocation.get(resource.id) || 0;
  return Math.max(0, needed - allocated);
};

// Get effective owned (resource.owned + allocated from inventory)
const getEffectiveOwned = (
  resource: Resource,
  allocation: Map<string, number>
): number => {
  const allocated = allocation.get(resource.id) || 0;
  return resource.owned + allocated;
};

const isResourceComplete = (r: Resource, allocation?: Map<string, number>): boolean => {
  if (r.needed <= 0) return true;
  const owned = allocation ? getEffectiveOwned(r, allocation) : r.owned;
  return owned >= r.needed;
};

const getProgressPercentage = (resources: Resource[], allocation?: Map<string, number>): number => {
  if (resources.length === 0) return 0;
  const completed = resources.filter((r) => isResourceComplete(r, allocation)).length;
  return Math.round((completed / resources.length) * 100);
};

const getCharacterProgress = (character: Character, allocation?: Map<string, number>): number => {
  return getProgressPercentage(character.resources, allocation);
};

const getGameProgress = (game: Game, allocation?: Map<string, number>): number => {
  if (game.characters.length === 0) return 0;
  const alloc = allocation ?? calculateInventoryAllocation(game);
  const allResources = game.characters.flatMap((c) => c.resources);
  return getProgressPercentage(allResources, alloc);
};

const getOverallProgress = (data: AppData): number => {
  if (data.games.length === 0) return 0;
  const allResources = data.games.flatMap((g) => {
    const alloc = calculateInventoryAllocation(g);
    return g.characters.flatMap((c) => c.resources).map((r) => ({ r, alloc }));
  });
  if (allResources.length === 0) return 0;
  const completed = allResources.filter(({ r, alloc }) => isResourceComplete(r, alloc)).length;
  return Math.round((completed / allResources.length) * 100);
};

// For inventory display: how much of an item is still needed across all characters (after direct farm)
// and how much surplus remains after all allocations
const getInventoryItemStatus = (game: Game, item: { id: string; owned: number; name: string }) => {
  // Total needed across all characters for this item
  const totalNeeded = getTotalNeededForItem(game, item.id);
  // What characters have already farmed directly (resource.owned for resources linked to this item)
  let directlyOwned = 0;
  game.characters.forEach(c => {
    c.resources.forEach(r => {
      if (r.inventoryItemId === item.id) directlyOwned += r.owned;
    });
  });
  const effectiveNeeded = Math.max(0, totalNeeded - directlyOwned);
  const surplus = Math.max(0, item.owned - effectiveNeeded);
  const missing = Math.max(0, effectiveNeeded - item.owned);
  return { totalNeeded, effectiveNeeded, surplus, missing };
};

const priorityLabels: Record<Priority, string> = {
  high: 'Haute',
  medium: 'Moyenne',
  low: 'Basse',
};

const priorityColors: Record<Priority, string> = {
  high: 'text-red-400 bg-red-400/10 border-red-400/30',
  medium: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30',
  low: 'text-blue-400 bg-blue-400/10 border-blue-400/30',
};

const dayLabels: Record<DayOfWeek, string> = {
  mon: 'Lundi',
  tue: 'Mardi',
  wed: 'Mercredi',
  thu: 'Jeudi',
  fri: 'Vendredi',
  sat: 'Samedi',
  sun: 'Dimanche',
  any: 'Tous les jours',
};

// Toast Component
interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

const ToastNotification = ({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) => {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 3000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  const bgColor = toast.type === 'success' ? 'bg-green-500' : toast.type === 'error' ? 'bg-red-500' : 'bg-blue-500';

  return (
    <div
      className={`fixed bottom-4 right-4 ${bgColor} text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 animate-fade-in z-50`}
    >
      {toast.type === 'success' && <Check className="w-5 h-5" />}
      {toast.type === 'error' && <AlertTriangle className="w-5 h-5" />}
      <span>{toast.message}</span>
      <button onClick={onDismiss} className="ml-2 hover:opacity-80">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};

// Modal Component
const Modal = ({
  isOpen,
  onClose,
  title,
  children,
  size = 'md',
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) => {
  if (!isOpen) return null;

  const sizeClass = size === 'lg' ? 'max-w-2xl' : size === 'md' ? 'max-w-md' : 'max-w-sm';

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div
        className={`bg-slate-800 rounded-xl shadow-2xl ${sizeClass} w-full max-h-[90vh] overflow-y-auto animate-fade-in border border-slate-700`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-slate-700">
          <h2 className="text-lg font-semibold text-slate-100">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
};

// Checklist Card Component
const ChecklistCard = ({
  checklist,
  characterId,
  onToggleItem,
  onUpdateItem,
  onDeleteItem,
  onAddItem,
  onDeleteChecklist,
}: {
  checklist: Checklist;
  characterId: string;
  onToggleItem: (characterId: string, checklistId: string, itemId: string) => void;
  onUpdateItem: (characterId: string, checklistId: string, itemId: string, text: string) => void;
  onDeleteItem: (characterId: string, checklistId: string, itemId: string) => void;
  onAddItem: (characterId: string, checklistId: string, text: string) => void;
  onDeleteChecklist: (characterId: string, checklistId: string) => void;
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [newItemText, setNewItemText] = useState('');
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');

  const completedItems = checklist.items.filter(i => i.isDone).length;
  const percentage = checklist.items.length > 0 ? Math.round((completedItems / checklist.items.length) * 100) : 0;

  return (
    <div className="bg-slate-700/50 rounded-lg border border-slate-600 animate-fade-in">
      <div
        className="flex items-center justify-between p-3 cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2 flex-1">
          <ChevronLeft className={`w-4 h-4 text-slate-400 transition-transform ${isExpanded ? '-rotate-90' : ''}`} />
          <span className="font-medium text-slate-100">{checklist.title}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">{completedItems}/{checklist.items.length}</span>
          <div className="w-16 h-2 bg-slate-600 rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 transition-all duration-300"
              style={{ width: `${percentage}%` }}
            />
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (confirm('Supprimer cette checklist ?')) {
                onDeleteChecklist(characterId, checklist.id);
              }
            }}
            className="p-1 hover:bg-red-500/20 rounded text-slate-400 hover:text-red-400 transition-colors"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="px-3 pb-3 space-y-1">
          {checklist.items.map((item) => (
            <div key={item.id} className="flex items-center gap-2 group animate-fade-in">
              <button
                onClick={() => onToggleItem(characterId, checklist.id, item.id)}
                className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                  item.isDone
                    ? 'bg-green-500 border-green-500 text-white'
                    : 'border-slate-500 hover:border-green-400'
                }`}
              >
                {item.isDone && <Check className="w-3 h-3" />}
              </button>
              {editingItemId === item.id ? (
                <input
                  type="text"
                  value={editingText}
                  onChange={(e) => setEditingText(e.target.value)}
                  onBlur={() => {
                    if (editingText.trim()) {
                      onUpdateItem(characterId, checklist.id, item.id, editingText.trim());
                    }
                    setEditingItemId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && editingText.trim()) {
                      onUpdateItem(characterId, checklist.id, item.id, editingText.trim());
                      setEditingItemId(null);
                    }
                    if (e.key === 'Escape') {
                      setEditingItemId(null);
                    }
                  }}
                  className="flex-1 bg-slate-600 border border-slate-500 rounded px-2 py-0.5 text-sm text-slate-100 focus:outline-none focus:border-blue-500"
                  autoFocus
                />
              ) : (
                <span
                  className={`flex-1 text-sm cursor-pointer ${item.isDone ? 'text-slate-500 line-through' : 'text-slate-200'}`}
                  onClick={() => {
                    setEditingItemId(item.id);
                    setEditingText(item.text);
                  }}
                >
                  {item.text}
                </span>
              )}
              <button
                onClick={() => onDeleteItem(characterId, checklist.id, item.id)}
                className="p-1 opacity-0 group-hover:opacity-100 hover:bg-red-500/20 rounded text-slate-400 hover:text-red-400 transition-all"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}

          {/* Add new item */}
          <div className="flex items-center gap-2 mt-2">
            <input
              type="text"
              value={newItemText}
              onChange={(e) => setNewItemText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newItemText.trim()) {
                  onAddItem(characterId, checklist.id, newItemText.trim());
                  setNewItemText('');
                }
              }}
              placeholder="Ajouter un item..."
              className="flex-1 bg-slate-600 border border-slate-500 rounded px-2 py-1 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
            {newItemText.trim() && (
              <button
                onClick={() => {
                  onAddItem(characterId, checklist.id, newItemText.trim());
                  setNewItemText('');
                }}
                className="p-1 bg-blue-600 hover:bg-blue-700 rounded text-white transition-colors"
              >
                <Plus className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// Progress Bar Component
const ProgressBar = ({ percentage, color, size = 'sm' }: { percentage: number; color?: string; size?: 'sm' | 'md' | 'lg' }) => {
  const heightClass = size === 'sm' ? 'h-2' : size === 'md' ? 'h-3' : 'h-4';
  return (
    <div className={`${heightClass} bg-slate-700 rounded-full overflow-hidden`}>
      <div
        className={`h-full transition-all duration-300 rounded-full ${size === 'lg' ? 'flex items-center justify-end pr-2' : ''}`}
        style={{
          width: `${percentage}%`,
          backgroundColor: color || '#3b82f6',
        }}
      >
        {size === 'lg' && percentage > 15 && (
          <span className="text-xs font-bold text-white">{percentage}%</span>
        )}
      </div>
    </div>
  );
};

// Star Rating Component
const StarRating = ({ rarity, maxStars = 6 }: { rarity: number; maxStars?: number }) => (
  <div className="flex gap-0.5">
    {Array.from({ length: Math.min(rarity, maxStars) }).map((_, i) => (
      <Star key={i} className="w-3 h-3 fill-yellow-400 text-yellow-400" />
    ))}
  </div>
);

// Default data
const defaultData: AppData = {
  version: '2.0',
  games: [],
};

export default function App() {
  // State
  const [data, setData] = useState<AppData>(defaultData);
  const [currentView, setCurrentView] = useState<ViewType>('dashboard');
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [hideCompleted, setHideCompleted] = useState(false);
  const [priorityFilter, setPriorityFilter] = useState<Priority | 'all'>('all');
  const [elementFilter, setElementFilter] = useState<string>('all');

  // Modals
  const [showGameModal, setShowGameModal] = useState(false);
  const [showCharacterModal, setShowCharacterModal] = useState(false);
  const [showResourceModal, setShowResourceModal] = useState(false);
  const [showInventoryModal, setShowInventoryModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<{
    type: 'game' | 'character' | 'resource' | 'inventory';
    id: string;
    name: string;
  } | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showFarmAllConfirm, setShowFarmAllConfirm] = useState(false);
  const [showResourceTypesModal, setShowResourceTypesModal] = useState(false);
  const [showLevelModal, setShowLevelModal] = useState(false);

  // Form states
  const [editingGame, setEditingGame] = useState<Game | null>(null);
  const [editingCharacter, setEditingCharacter] = useState<Character | null>(null);
  const [editingResource, setEditingResource] = useState<Resource | null>(null);
  const [editingInventoryItem, setEditingInventoryItem] = useState<InventoryItem | null>(null);
  const [pendingInventoryType, setPendingInventoryType] = useState<string | null>(null);
  const [inlineEditValue, setInlineEditValue] = useState<string>('');
  const [inlineEditResourceId, setInlineEditResourceId] = useState<string | null>(null);
  const [inlineEditGameId, setInlineEditGameId] = useState<string | null>(null);
  const [inlineEditCharacterId, setInlineEditCharacterId] = useState<string | null>(null);
  const [newResourceType, setNewResourceType] = useState('');
  const [newLevel, setNewLevel] = useState(1);

  // Load data from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('gacha-farm-data');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.games && Array.isArray(parsed.games)) {
          // Migrate old data
          const migrated = {
            ...parsed,
            version: '2.0',
            games: parsed.games.map((g: Game) => ({
              ...g,
              imageUrl: g.imageUrl || '',
              inventory: g.inventory || [],
              resourceTypes: g.resourceTypes || defaultResourceTypes,
              elements: g.elements || [],
              energyName: g.energyName || '',
              currencyName: g.currencyName || '',
              characters: g.characters.map((c: Character) => ({
                ...c,
                rarity: typeof c.rarity === 'number' ? c.rarity : (c.rarity === 5 ? 5 : 4),
                skills: c.skills || '',
                imageUrl: c.imageUrl || '',
                checklists: c.checklists || [],
                resources: c.resources.map((r: Resource) => ({
                  ...r,
                  imageUrl: r.imageUrl || '',
                  energyCost: r.energyCost || 0,
                  dropRate: r.dropRate || 0,
                  weeklyRuns: r.weeklyRuns || 0,
                  runsDone: r.runsDone || 0,
                  resetDay: r.resetDay,
                  lastResetDate: r.lastResetDate,
                })),
              })),
            })),
          };
          setData(migrated);
        }
      } catch (e) {
        console.error('Failed to parse saved data:', e);
      }
    }
  }, []);

  // Save data to localStorage
  const saveData = useCallback((newData: AppData) => {
    setData(newData);
    localStorage.setItem('gacha-farm-data', JSON.stringify(newData, null, 2));
  }, []);

  // Toast helpers
  const showToast = useCallback((message: string, type: Toast['type'] = 'info') => {
    const id = generateId();
    setToasts((prev) => [...prev, { id, message, type }]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Export function
  const handleExport = useCallback(() => {
    const date = new Date().toISOString().split('T')[0];
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gacha-farm-backup-${date}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Donnees exportees avec succes !', 'success');
  }, [data, showToast]);

  // Import function
  const handleImport = useCallback(
    (file: File, replace: boolean) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const imported = JSON.parse(e.target?.result as string);
          if (!imported.games || !Array.isArray(imported.games)) {
            showToast('Structure de fichier invalide. Tableau "games" manquant.', 'error');
            return;
          }
          if (replace) {
            saveData({ version: '2.0', games: imported.games });
          } else {
            const mergedGames = [...data.games, ...imported.games];
            saveData({ version: '2.0', games: mergedGames });
          }
          showToast(`${imported.games.length} jeu(x) importe(s) avec succes !`, 'success');
          setShowImportModal(false);
        } catch (err) {
          showToast('Fichier JSON invalide. Verifiez le format.', 'error');
        }
      };
      reader.readAsText(file);
    },
    [data, saveData, showToast]
  );

  // Game CRUD
  const handleSaveGame = useCallback(
    (game: Partial<Game>) => {
      if (editingGame) {
        const updated = data.games.map((g) =>
          g.id === editingGame.id ? { ...g, ...game } : g
        );
        saveData({ ...data, games: updated });
        showToast('Jeu mis a jour !', 'success');
      } else {
        const newGame: Game = {
          id: generateId(),
          name: game.name || 'Nouveau Jeu',
          icon: game.icon || '🎮',
          imageUrl: game.imageUrl || '',
          color: game.color || '#3b82f6',
          characters: [],
          resourceTypes: defaultResourceTypes,
          inventory: [],
          elements: game.elements || [],
          energyName: game.energyName || '',
          currencyName: game.currencyName || '',
        };
        saveData({ ...data, games: [...data.games, newGame] });
        showToast('Jeu ajoute !', 'success');
      }
      setShowGameModal(false);
      setEditingGame(null);
    },
    [data, editingGame, saveData, showToast]
  );

  const handleDeleteGame = useCallback(
    (gameId: string) => {
      const updated = data.games.filter((g) => g.id !== gameId);
      saveData({ ...data, games: updated });
      setShowDeleteConfirm(null);
      if (selectedGameId === gameId) {
        setSelectedGameId(null);
        setCurrentView('games');
      }
      showToast('Jeu supprime !', 'success');
    },
    [data, saveData, selectedGameId, showToast]
  );

  // Inventory CRUD
  const handleSaveInventoryItem = useCallback(
    (item: Partial<InventoryItem>) => {
      if (!selectedGameId) return;

      if (editingInventoryItem) {
        const updated = data.games.map((g) => {
          if (g.id !== selectedGameId) return g;
          return {
            ...g,
            inventory: g.inventory.map((i) =>
              i.id === editingInventoryItem.id ? { ...i, ...item } : i
            ),
          };
        });
        saveData({ ...data, games: updated });
        showToast('Objet d\'inventaire mis a jour !', 'success');
      } else {
        const newItem: InventoryItem = {
          id: generateId(),
          name: item.name || 'Nouvel objet',
          type: item.type || 'Materiau',
          icon: item.icon || '📦',
          imageUrl: item.imageUrl || '',
          owned: item.owned || 0,
          energyCost: item.energyCost,
          dropRate: item.dropRate,
          farmLocation: item.farmLocation,
          daysAvailable: item.daysAvailable,
          weeklyRuns: item.weeklyRuns,
          resetDay: item.resetDay,
        };
        const updated = data.games.map((g) => {
          if (g.id !== selectedGameId) return g;
          return { ...g, inventory: [...g.inventory, newItem] };
        });
        saveData({ ...data, games: updated });
        showToast('Objet ajoute a l\'inventaire !', 'success');
      }
      setShowInventoryModal(false);
      setEditingInventoryItem(null);
      setPendingInventoryType(null);
    },
    [data, selectedGameId, editingInventoryItem, saveData, showToast]
  );

  const handleDeleteInventoryItem = useCallback(
    (itemId: string) => {
      if (!selectedGameId) return;
      const updated = data.games.map((g) => {
        if (g.id !== selectedGameId) return g;
        return { ...g, inventory: g.inventory.filter((i) => i.id !== itemId) };
      });
      saveData({ ...data, games: updated });
      setShowDeleteConfirm(null);
      showToast('Objet supprime de l\'inventaire !', 'success');
    },
    [data, selectedGameId, saveData, showToast]
  );

  const handleUpdateInventoryOwned = useCallback(
    (gameId: string, itemId: string, newOwned: number) => {
      const updated = data.games.map((g) => {
        if (g.id !== gameId) return g;
        return {
          ...g,
          inventory: g.inventory.map((i) =>
            i.id === itemId ? { ...i, owned: Math.max(0, newOwned) } : i
          ),
        };
      });
      saveData({ ...data, games: updated });
    },
    [data, saveData]
  );

  // Add/Remove/Rename resource type
  const handleAddResourceType = useCallback(
    (type: string) => {
      if (!selectedGameId) return;
      const game = data.games.find((g) => g.id === selectedGameId);
      if (!game) return;
      if (game.resourceTypes.includes(type)) {
        showToast('Ce type existe déjà !', 'error');
        return;
      }
      const updated = data.games.map((g) =>
        g.id === selectedGameId ? { ...g, resourceTypes: [...g.resourceTypes, type] } : g
      );
      saveData({ ...data, games: updated });
      showToast('Type ajouté !', 'success');
    },
    [data, selectedGameId, saveData, showToast]
  );

  const handleRenameResourceType = useCallback(
    (oldType: string, newType: string) => {
      if (!selectedGameId) return;
      const trimmed = newType.trim();
      if (!trimmed || trimmed === oldType) return;
      const game = data.games.find((g) => g.id === selectedGameId);
      if (!game) return;
      if (game.resourceTypes.includes(trimmed)) {
        showToast('Ce type existe déjà !', 'error');
        return;
      }
      const updated = data.games.map((g) => {
        if (g.id !== selectedGameId) return g;
        return {
          ...g,
          // Rename in the list
          resourceTypes: g.resourceTypes.map((t) => (t === oldType ? trimmed : t)),
          // Rename retroactively on all inventory items that used this type
          inventory: g.inventory.map((item) =>
            item.type === oldType ? { ...item, type: trimmed } : item
          ),
        };
      });
      saveData({ ...data, games: updated });
      showToast(`Type renommé en "${trimmed}"`, 'success');
    },
    [data, selectedGameId, saveData, showToast]
  );

  const handleRemoveResourceType = useCallback(
    (type: string) => {
      if (!selectedGameId) return;
      const game = data.games.find((g) => g.id === selectedGameId);
      if (!game) return;
      const itemsUsing = game.inventory.filter((i) => i.type === type);
      if (itemsUsing.length > 0) {
        if (!confirm(`${itemsUsing.length} objet(s) utilisent ce type. Supprimer quand même ? Ils passeront en type "Autre".`)) return;
        // Migrate items to "Autre"
        const updated = data.games.map((g) => {
          if (g.id !== selectedGameId) return g;
          return {
            ...g,
            resourceTypes: g.resourceTypes.filter((t) => t !== type),
            inventory: g.inventory.map((item) =>
              item.type === type ? { ...item, type: 'Autre' } : item
            ),
          };
        });
        saveData({ ...data, games: updated });
      } else {
        const updated = data.games.map((g) =>
          g.id === selectedGameId ? { ...g, resourceTypes: g.resourceTypes.filter((t) => t !== type) } : g
        );
        saveData({ ...data, games: updated });
      }
      showToast('Type supprimé !', 'success');
    },
    [data, selectedGameId, saveData, showToast]
  );

  // Character CRUD
  const handleSaveCharacter = useCallback(
    (character: Partial<Character>) => {
      if (!selectedGameId) return;
      const game = data.games.find((g) => g.id === selectedGameId);
      if (!game) return;

      if (editingCharacter) {
        const updatedGames = data.games.map((g) => {
          if (g.id !== selectedGameId) return g;
          return {
            ...g,
            characters: g.characters.map((c) =>
              c.id === editingCharacter.id ? { ...c, ...character } : c
            ),
          };
        });
        saveData({ ...data, games: updatedGames });
        showToast('Personnage mis a jour !', 'success');
      } else {
        const newCharacter: Character = {
          id: generateId(),
          name: character.name || 'Nouveau Personnage',
          element: character.element || 'Inconnu',
          rarity: character.rarity || 5,
          image: character.image || '👤',
          imageUrl: character.imageUrl || '',
          priority: character.priority || 'medium',
          targetLevel: character.targetLevel || 90,
          currentLevel: character.currentLevel || 1,
          skills: character.skills || '',
          resources: [],
          checklists: [],
        };
        const updatedGames = data.games.map((g) => {
          if (g.id !== selectedGameId) return g;
          return { ...g, characters: [...g.characters, newCharacter] };
        });
        saveData({ ...data, games: updatedGames });
        showToast('Personnage ajoute !', 'success');
      }
      setShowCharacterModal(false);
      setEditingCharacter(null);
    },
    [data, selectedGameId, editingCharacter, saveData, showToast]
  );

  const handleDeleteCharacter = useCallback(
    (characterId: string) => {
      const updatedGames = data.games.map((g) => {
        if (g.id !== selectedGameId) return g;
        return { ...g, characters: g.characters.filter((c) => c.id !== characterId) };
      });
      saveData({ ...data, games: updatedGames });
      setShowDeleteConfirm(null);
      if (selectedCharacterId === characterId) {
        setSelectedCharacterId(null);
        setCurrentView('game-detail');
      }
      showToast('Personnage supprime !', 'success');
    },
    [data, selectedGameId, selectedCharacterId, saveData, showToast]
  );

  // Update character level
  const handleUpdateLevel = useCallback(
    (characterId: string, newCurrentLevel: number) => {
      const updatedGames = data.games.map((g) => {
        if (g.id !== selectedGameId) return g;
        return {
          ...g,
          characters: g.characters.map((c) =>
            c.id === characterId ? { ...c, currentLevel: newCurrentLevel } : c
          ),
        };
      });
      saveData({ ...data, games: updatedGames });
      setShowLevelModal(false);
      showToast('Niveau mis a jour !', 'success');
    },
    [data, selectedGameId, saveData, showToast]
  );

  // Resource CRUD
  const handleSaveResource = useCallback(
    (resource: Partial<Resource>) => {
      if (!selectedGameId || !selectedCharacterId) return;

      if (editingResource) {
        const updatedGames = data.games.map((g) => {
          if (g.id !== selectedGameId) return g;
          return {
            ...g,
            characters: g.characters.map((c) => {
              if (c.id !== selectedCharacterId) return c;
              return {
                ...c,
                resources: c.resources.map((r) =>
                  r.id === editingResource.id ? { ...r, ...resource } : r
                ),
              };
            }),
          };
        });
        saveData({ ...data, games: updatedGames });
        showToast('Ressource mise a jour !', 'success');
      } else {
        const newResource: Resource = {
          id: generateId(),
          name: resource.name || 'Nouvelle Ressource',
          type: resource.type || 'Materiau',
          icon: resource.icon || '📦',
          imageUrl: resource.imageUrl || '',
          needed: resource.needed || 0,
          owned: resource.owned || 0,
          farmLocation: resource.farmLocation || '',
          daysAvailable: resource.daysAvailable || ['any'],
          isCompleted: false,
          energyCost: resource.energyCost || 0,
          dropRate: resource.dropRate || 0,
          inventoryItemId: resource.inventoryItemId,
          weeklyRuns: resource.weeklyRuns || 0,
          runsDone: resource.runsDone || 0,
          resetDay: resource.resetDay,
          lastResetDate: resource.lastResetDate,
        };
        const updatedGames = data.games.map((g) => {
          if (g.id !== selectedGameId) return g;
          return {
            ...g,
            characters: g.characters.map((c) => {
              if (c.id !== selectedCharacterId) return c;
              return { ...c, resources: [...c.resources, newResource] };
            }),
          };
        });
        saveData({ ...data, games: updatedGames });
        showToast('Ressource ajoutee !', 'success');
      }
      setShowResourceModal(false);
      setEditingResource(null);
    },
    [data, selectedGameId, selectedCharacterId, editingResource, saveData, showToast]
  );

  const handleDeleteResource = useCallback(
    (resourceId: string) => {
      const updatedGames = data.games.map((g) => {
        if (g.id !== selectedGameId) return g;
        return {
          ...g,
          characters: g.characters.map((c) => {
            if (c.id !== selectedCharacterId) return c;
            return { ...c, resources: c.resources.filter((r) => r.id !== resourceId) };
          }),
        };
      });
      saveData({ ...data, games: updatedGames });
      setShowDeleteConfirm(null);
      showToast('Ressource supprimee !', 'success');
    },
    [data, selectedGameId, selectedCharacterId, saveData, showToast]
  );

  const handleUpdateResourceOwned = useCallback(
    (gameId: string, _characterId: string, resourceId: string, newOwned: number) => {
      // Inline edit updates only the inventory item quantity (single source of truth).
      // resource.owned is only for items farmed outside the inventory system.
      const updatedGames = data.games.map((g) => {
        if (g.id !== gameId) return g;

        let inventoryItemId: string | undefined;
        for (const c of g.characters) {
          const r = c.resources.find(r => r.id === resourceId);
          if (r) { inventoryItemId = r.inventoryItemId; break; }
        }

        return {
          ...g,
          inventory: g.inventory.map((item) =>
            item.id === inventoryItemId
              ? { ...item, owned: Math.max(0, newOwned) }
              : item
          ),
        };
      });
      saveData({ ...data, games: updatedGames });
    },
    [data, saveData]
  );

  // Update weekly runs done
  const handleUpdateRunsDone = useCallback(
    (gameId: string, characterId: string, resourceId: string, newRunsDone: number) => {
      const updatedGames = data.games.map((g) => {
        if (g.id !== gameId) return g;
        return {
          ...g,
          characters: g.characters.map((c) => {
            if (c.id !== characterId) return c;
            return {
              ...c,
              resources: c.resources.map((r) => {
                if (r.id !== resourceId) return r;
                const maxRuns = r.weeklyRuns || 0;
                return { ...r, runsDone: Math.min(maxRuns, Math.max(0, newRunsDone)) };
              }),
            };
          }),
        };
      });
      saveData({ ...data, games: updatedGames });
    },
    [data, saveData]
  );

  // Farm all today's resources
  const handleFarmAllToday = useCallback(() => {
    const today = getTodayDay();
    const updatedGames = data.games.map((g) => ({
      ...g,
      characters: g.characters.map((c) => ({
        ...c,
        resources: c.resources.map((r) => {
          const isToday = r.daysAvailable.includes('any') || r.daysAvailable.includes(today);
          if (isToday && r.owned < r.needed) {
            return { ...r, owned: r.needed };
          }
          return r;
        }),
      })),
    }));
    saveData({ ...data, games: updatedGames });
    setShowFarmAllConfirm(false);
    showToast('Toutes les ressources du jour marquees comme farmees !', 'success');
  }, [data, saveData, showToast]);

  // Checklist CRUD operations
  const handleAddChecklist = useCallback((characterId: string, title: string) => {
    const updatedGames = data.games.map((g) => ({
      ...g,
      characters: g.characters.map((c) => {
        if (c.id !== characterId) return c;
        const newChecklist: Checklist = {
          id: generateId(),
          title,
          items: [],
        };
        return { ...c, checklists: [...c.checklists, newChecklist] };
      }),
    }));
    saveData({ ...data, games: updatedGames });
    showToast('Checklist ajoutee !', 'success');
  }, [data, saveData, showToast]);

  const handleDeleteChecklist = useCallback((characterId: string, checklistId: string) => {
    const updatedGames = data.games.map((g) => ({
      ...g,
      characters: g.characters.map((c) => {
        if (c.id !== characterId) return c;
        return { ...c, checklists: c.checklists.filter(cl => cl.id !== checklistId) };
      }),
    }));
    saveData({ ...data, games: updatedGames });
    showToast('Checklist supprimee', 'success');
  }, [data, saveData, showToast]);

  const handleAddChecklistItem = useCallback((characterId: string, checklistId: string, text: string) => {
    const updatedGames = data.games.map((g) => ({
      ...g,
      characters: g.characters.map((c) => {
        if (c.id !== characterId) return c;
        return {
          ...c,
          checklists: c.checklists.map(cl => {
            if (cl.id !== checklistId) return cl;
            const newItem: ChecklistItem = { id: generateId(), text, isDone: false };
            return { ...cl, items: [...cl.items, newItem] };
          }),
        };
      }),
    }));
    saveData({ ...data, games: updatedGames });
  }, [data, saveData]);

  const handleToggleChecklistItem = useCallback((characterId: string, checklistId: string, itemId: string) => {
    const updatedGames = data.games.map((g) => ({
      ...g,
      characters: g.characters.map((c) => {
        if (c.id !== characterId) return c;
        return {
          ...c,
          checklists: c.checklists.map(cl => {
            if (cl.id !== checklistId) return cl;
            return {
              ...cl,
              items: cl.items.map(item =>
                item.id === itemId ? { ...item, isDone: !item.isDone } : item
              ),
            };
          }),
        };
      }),
    }));
    saveData({ ...data, games: updatedGames });
  }, [data, saveData]);

  const handleUpdateChecklistItem = useCallback((characterId: string, checklistId: string, itemId: string, text: string) => {
    const updatedGames = data.games.map((g) => ({
      ...g,
      characters: g.characters.map((c) => {
        if (c.id !== characterId) return c;
        return {
          ...c,
          checklists: c.checklists.map(cl => {
            if (cl.id !== checklistId) return cl;
            return {
              ...cl,
              items: cl.items.map(item =>
                item.id === itemId ? { ...item, text } : item
              ),
            };
          }),
        };
      }),
    }));
    saveData({ ...data, games: updatedGames });
  }, [data, saveData]);

  const handleDeleteChecklistItem = useCallback((characterId: string, checklistId: string, itemId: string) => {
    const updatedGames = data.games.map((g) => ({
      ...g,
      characters: g.characters.map((c) => {
        if (c.id !== characterId) return c;
        return {
          ...c,
          checklists: c.checklists.map(cl => {
            if (cl.id !== checklistId) return cl;
            return { ...cl, items: cl.items.filter(item => item.id !== itemId) };
          }),
        };
      }),
    }));
    saveData({ ...data, games: updatedGames });
  }, [data, saveData]);

  // Get today's resources
  const getTodayResources = useCallback(() => {
    type ResourceItem = {
      game: Game;
      character: Character;
      resource: Resource;
      characterOriginalIndex: number;
    };
    const resources: Array<ResourceItem> = [];

    data.games.forEach((game) => {
      const alloc = calculateInventoryAllocation(game);
      game.characters.forEach((character, characterIndex) => {
        character.resources.forEach((resource) => {
          const effectiveOwned = getEffectiveOwned(resource, alloc);
          const isComplete = effectiveOwned >= resource.needed;
          if (!hideCompleted || !isComplete) {
            resources.push({ game, character, resource, characterOriginalIndex: characterIndex });
          }
        });
      });
    });

    // Stable sort by priority, then by original character order
    resources.sort((a, b) => {
      const priorityDiff = priorityOrder[a.character.priority] - priorityOrder[b.character.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return a.characterOriginalIndex - b.characterOriginalIndex;
    });

    // Return without internal field
    return resources.map(({ game, character, resource }) => ({ game, character, resource }));
  }, [data, hideCompleted]);

  // Get filtered characters
  const getFilteredCharacters = useCallback(
    (game: Game) => {
      return game.characters.filter((c) => {
        if (priorityFilter !== 'all' && c.priority !== priorityFilter) return false;
        if (elementFilter !== 'all' && c.element !== elementFilter) return false;
        return true;
      });
    },
    [priorityFilter, elementFilter]
  );

  // Get unique elements from a game
  const getGameElements = useCallback((game: Game) => {
    const elements = new Set(game.characters.map((c) => c.element));
    return Array.from(elements);
  }, []);

  // Navigate
  const navigateToGame = (gameId: string) => {
    setSelectedGameId(gameId);
    setCurrentView('game-detail');
  };

  const navigateToCharacter = (characterId: string) => {
    setSelectedCharacterId(characterId);
    setCurrentView('character-detail');
  };

  const navigateBack = () => {
    if (currentView === 'character-detail') {
      setCurrentView('game-detail');
      setSelectedCharacterId(null);
    } else if (currentView === 'game-detail' || currentView === 'inventory') {
      setCurrentView('games');
      setSelectedGameId(null);
    } else {
      setCurrentView('dashboard');
    }
  };

  // Get current game/character
  const currentGame = data.games.find((g) => g.id === selectedGameId);
  const currentCharacter = currentGame?.characters.find((c) => c.id === selectedCharacterId);

  // Inline edit handlers
  const startInlineEdit = (gameId: string, characterId: string, resourceId: string, currentValue: number) => {
    setInlineEditGameId(gameId);
    setInlineEditCharacterId(characterId);
    setInlineEditResourceId(resourceId);
    setInlineEditValue(currentValue.toString());
  };

  const finishInlineEdit = () => {
    if (inlineEditResourceId && inlineEditGameId && inlineEditCharacterId && inlineEditValue !== '') {
      handleUpdateResourceOwned(inlineEditGameId, inlineEditCharacterId, inlineEditResourceId, parseInt(inlineEditValue) || 0);
    }
    setInlineEditResourceId(null);
    setInlineEditGameId(null);
    setInlineEditCharacterId(null);
    setInlineEditValue('');
  };

  // Game Form Component
  const GameForm = () => {
    const [name, setName] = useState(editingGame?.name || '');
    const [icon, setIcon] = useState(editingGame?.icon || '🎮');
    const [imageUrl, setImageUrl] = useState(editingGame?.imageUrl || '');
    const [color, setColor] = useState(editingGame?.color || '#3b82f6');
    const [energyName, setEnergyName] = useState(editingGame?.energyName || '');
    const [currencyName, setCurrencyName] = useState(editingGame?.currencyName || '');
    const [elementsInput, setElementsInput] = useState(
      (editingGame?.elements || []).join(', ')
    );

    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const elements = elementsInput
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
          handleSaveGame({ name, icon, imageUrl, color, elements, energyName, currencyName });
        }}
        className="space-y-4"
      >
        <div>
          <label className="block text-sm text-slate-400 mb-1">Nom du jeu</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500"
            required
          />
        </div>
        <div>
          <label className="block text-sm text-slate-400 mb-1">Icone Emoji (fallback)</label>
          <input
            type="text"
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 text-2xl focus:outline-none focus:border-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm text-slate-400 mb-1 flex items-center gap-2">
            <ImageIcon className="w-4 h-4" />
            URL du logo (optionnel)
          </label>
          <input
            type="url"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500"
            placeholder="https://i.imgur.com/..."
          />
          {imageUrl && (
            <div className="mt-2 flex justify-center">
              <img
                src={imageUrl}
                alt="Preview"
                className="w-16 h-16 object-contain rounded-lg border border-slate-600"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            </div>
          )}
        </div>
        <div>
          <label className="block text-sm text-slate-400 mb-1">Couleur du theme</label>
          <div className="flex gap-2">
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="w-12 h-10 bg-slate-700 border border-slate-600 rounded-lg cursor-pointer"
            />
            <input
              type="text"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        {/* Game Customization Section */}
        <div className="border-t border-slate-700 pt-4 space-y-4">
          <p className="text-sm font-medium text-slate-300 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-purple-400" />
            Personnalisation du jeu
          </p>

          <div>
            <label className="block text-sm text-slate-400 mb-1">
              Elements / Types de personnages
            </label>
            <input
              type="text"
              value={elementsInput}
              onChange={(e) => setElementsInput(e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500"
              placeholder="ex: Pyro, Cryo, Hydro, Anemo..."
            />
            <p className="text-xs text-slate-500 mt-1">
              Séparez par des virgules. Ces éléments seront proposés à la création de personnages.
            </p>
            {elementsInput.trim() && (
              <div className="flex flex-wrap gap-1 mt-2">
                {elementsInput.split(',').map((el) => el.trim()).filter(Boolean).map((el) => (
                  <span key={el} className="px-2 py-0.5 bg-purple-500/20 text-purple-300 border border-purple-500/30 rounded text-xs">
                    {el}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-slate-400 mb-1">
                Nom de l'énergie / endurance
              </label>
              <input
                type="text"
                value={energyName}
                onChange={(e) => setEnergyName(e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500"
                placeholder="ex: Résine, Endurance..."
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">
                Monnaie principale
              </label>
              <input
                type="text"
                value={currencyName}
                onChange={(e) => setCurrencyName(e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500"
                placeholder="ex: Primogemmes, Astrite..."
              />
            </div>
          </div>
        </div>

        <button
          type="submit"
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 rounded-lg transition-colors"
        >
          {editingGame ? 'Mettre a jour' : 'Ajouter'}
        </button>
      </form>
    );
  };

  // Character Form Component
  const CharacterForm = () => {
    const game = currentGame;
    const gameElements = game?.elements || [];

    const [name, setName] = useState(editingCharacter?.name || '');
    const [element, setElement] = useState(editingCharacter?.element || (gameElements[0] || ''));
    const [rarity, setRarity] = useState(editingCharacter?.rarity || 5);
    const [image, setImage] = useState(editingCharacter?.image || '👤');
    const [imageUrl, setImageUrl] = useState(editingCharacter?.imageUrl || '');
    const [priority, setPriority] = useState<Priority>(editingCharacter?.priority || 'medium');
    const [currentLevel, setCurrentLevel] = useState(editingCharacter?.currentLevel || 1);
    const [targetLevel, setTargetLevel] = useState(editingCharacter?.targetLevel || 90);
    const [skills, setSkills] = useState(editingCharacter?.skills || '');

    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSaveCharacter({ name, element, rarity, image, imageUrl, priority, currentLevel, targetLevel, skills });
        }}
        className="space-y-4"
      >
        <div>
          <label className="block text-sm text-slate-400 mb-1">Nom du personnage</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500"
            required
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm text-slate-400 mb-1">Element/Type</label>
            {gameElements.length > 0 ? (
              <select
                value={element}
                onChange={(e) => setElement(e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500"
              >
                {gameElements.map((el) => (
                  <option key={el} value={el}>{el}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={element}
                onChange={(e) => setElement(e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500"
                placeholder="ex: Pyro"
              />
            )}
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Rarete (1-6)</label>
            <input
              type="number"
              value={rarity}
              onChange={(e) => setRarity(Math.min(6, Math.max(1, parseInt(e.target.value) || 1)))}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500"
              min={1}
              max={6}
            />
          </div>
        </div>
        <div>
          <label className="block text-sm text-slate-400 mb-1">Icone Emoji (fallback)</label>
          <input
            type="text"
            value={image}
            onChange={(e) => setImage(e.target.value)}
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 text-2xl focus:outline-none focus:border-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm text-slate-400 mb-1 flex items-center gap-2">
            <ImageIcon className="w-4 h-4" />
            URL de l'image (optionnel)
          </label>
          <input
            type="url"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500"
            placeholder="https://i.imgur.com/..."
          />
          {imageUrl && (
            <div className="mt-2 flex justify-center">
              <img
                src={imageUrl}
                alt="Preview"
                className="w-20 h-20 object-cover rounded-lg border border-slate-600"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            </div>
          )}
        </div>
        <div>
          <label className="block text-sm text-slate-400 mb-1">Priorite</label>
          <div className="flex gap-2">
            {(['high', 'medium', 'low'] as Priority[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPriority(p)}
                className={`flex-1 py-2 rounded-lg border transition-colors ${
                  priority === p ? priorityColors[p] : 'bg-slate-700 border-slate-600 text-slate-400'
                }`}
              >
                {priorityLabels[p]}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm text-slate-400 mb-1">Niveau actuel</label>
            <input
              type="number"
              value={currentLevel}
              onChange={(e) => setCurrentLevel(parseInt(e.target.value) || 1)}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500"
              min={1}
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Niveau cible</label>
            <input
              type="number"
              value={targetLevel}
              onChange={(e) => setTargetLevel(parseInt(e.target.value) || 90)}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500"
              min={1}
            />
          </div>
        </div>
        <div>
          <label className="block text-sm text-slate-400 mb-1 flex items-center gap-2">
            <Sparkles className="w-4 h-4" />
            Competences / Passifs / Notes
          </label>
          <textarea
            value={skills}
            onChange={(e) => setSkills(e.target.value)}
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500 min-h-[100px]"
            placeholder="ex: Competence E niveau 8, Passif debloque a C1..."
            rows={4}
          />
        </div>
        <button
          type="submit"
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 rounded-lg transition-colors"
        >
          {editingCharacter ? 'Mettre a jour' : 'Ajouter'}
        </button>
      </form>
    );
  };

  // Resource Form Component
  const ResourceForm = () => {
    const game = currentGame;
    const inventoryItems = game?.inventory || [];

    const [selectedInventoryId, setSelectedInventoryId] = useState<string>(
      editingResource?.inventoryItemId || ''
    );
    const [needed, setNeeded] = useState(editingResource?.needed || 0);
    const [owned, setOwned] = useState(editingResource?.owned || 0);
    const [isWeekly, setIsWeekly] = useState(!!editingResource?.weeklyRuns);
    const [weeklyRuns, setWeeklyRuns] = useState(editingResource?.weeklyRuns || 3);
    const [resetDay, setResetDay] = useState<DayOfWeek>(editingResource?.resetDay || 'mon');

    const selectedItem = inventoryItems.find((i) => i.id === selectedInventoryId);

    // When item changes, pre-fill weekly info from inventory item if not editing
    const handleSelectItem = (itemId: string) => {
      setSelectedInventoryId(itemId);
      if (!editingResource) {
        const item = inventoryItems.find((i) => i.id === itemId);
        if (item?.weeklyRuns && item.weeklyRuns > 0) {
          setIsWeekly(true);
          setWeeklyRuns(item.weeklyRuns);
          if (item.resetDay) setResetDay(item.resetDay);
        } else {
          setIsWeekly(false);
        }
      }
    };

    const toggleDay = (day: DayOfWeek) => {
      if (day === 'any') {
        setDaysAvailable(['any']);
      } else {
        const filtered = daysAvailable.filter((d) => d !== 'any');
        if (filtered.includes(day)) {
          const updated = filtered.filter((d) => d !== day);
          setDaysAvailable(updated.length === 0 ? ['any'] : updated);
        } else {
          setDaysAvailable([...filtered, day]);
        }
      }
    };

    const [daysAvailable, setDaysAvailable] = useState<DayOfWeek[]>(
      editingResource?.daysAvailable || ['any']
    );

    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!selectedItem) return;
          handleSaveResource({
            name: selectedItem.name,
            type: selectedItem.type,
            icon: selectedItem.icon,
            imageUrl: selectedItem.imageUrl || '',
            needed,
            owned,
            farmLocation: selectedItem.farmLocation || '',
            daysAvailable: selectedItem.daysAvailable?.length ? selectedItem.daysAvailable : daysAvailable,
            energyCost: selectedItem.energyCost || 0,
            dropRate: selectedItem.dropRate || 0,
            inventoryItemId: selectedItem.id,
            weeklyRuns: isWeekly ? weeklyRuns : 0,
            runsDone: isWeekly ? (editingResource?.runsDone || 0) : 0,
            resetDay: isWeekly ? resetDay : undefined,
            lastResetDate: isWeekly ? editingResource?.lastResetDate : undefined,
          });
        }}
        className="space-y-4"
      >
        <div>
          <label className="block text-sm text-slate-400 mb-1 flex items-center gap-2">
            <Warehouse className="w-4 h-4" />
            Selectionner un objet de l'inventaire
          </label>
          {inventoryItems.length === 0 ? (
            <div className="bg-slate-700/50 border border-dashed border-slate-600 rounded-lg p-4 text-center">
              <p className="text-slate-400 text-sm">Aucun objet dans l'inventaire.</p>
              <p className="text-slate-500 text-xs mt-1">
                Ajoutez d'abord des objets dans l'inventaire du jeu.
              </p>
            </div>
          ) : (
            <select
              value={selectedInventoryId}
              onChange={(e) => handleSelectItem(e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500"
              required
            >
              <option value="">-- Choisir un objet --</option>
              {inventoryItems.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.icon} {item.name} ({item.owned} en stock){item.weeklyRuns ? ` 🔄 ${item.weeklyRuns}x/sem` : ''}
                </option>
              ))}
            </select>
          )}
        </div>

        {selectedItem && (
          <div className="bg-slate-700/30 border border-slate-700 rounded-lg p-3 flex items-center gap-3 animate-fade-in">
            {selectedItem.imageUrl ? (
              <img
                src={selectedItem.imageUrl}
                alt={selectedItem.name}
                className="w-10 h-10 object-contain rounded"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            ) : (
              <span className="text-2xl">{selectedItem.icon}</span>
            )}
            <div className="flex-1 min-w-0">
              <p className="font-medium text-slate-100">{selectedItem.name}</p>
              <p className="text-xs text-slate-400">{selectedItem.type}</p>
              {selectedItem.farmLocation && (
                <p className="text-xs text-slate-500 mt-0.5">Lieu: {selectedItem.farmLocation}</p>
              )}
              {selectedItem.weeklyRuns && selectedItem.weeklyRuns > 0 && (
                <p className="text-xs text-purple-400 mt-0.5">
                  🔄 {selectedItem.weeklyRuns} run{selectedItem.weeklyRuns > 1 ? 's' : ''}/semaine · Reset {selectedItem.resetDay ? dayLabels[selectedItem.resetDay] : ''}
                </p>
              )}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm text-slate-400 mb-1">Necessaire</label>
            <input
              type="number"
              value={needed}
              onChange={(e) => setNeeded(parseInt(e.target.value) || 0)}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500"
              min={0}
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Possede</label>
            <input
              type="number"
              value={owned}
              onChange={(e) => setOwned(parseInt(e.target.value) || 0)}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500"
              min={0}
            />
          </div>
        </div>

        {selectedItem && (!selectedItem.daysAvailable || selectedItem.daysAvailable.length === 0) && (
          <div>
            <label className="block text-sm text-slate-400 mb-2">Jours disponibles</label>
            <div className="flex flex-wrap gap-1">
              {(['any', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as DayOfWeek[]).map((day) => (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleDay(day)}
                  className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                    daysAvailable.includes(day)
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                  }`}
                >
                  {day === 'any' ? 'Tous' : day.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Weekly Runs Section — only shown if the inventory item is configured as weekly */}
        {selectedItem && selectedItem.weeklyRuns && selectedItem.weeklyRuns > 0 ? (
          <div className="border-t border-slate-700 pt-4">
            <div className="flex items-center gap-2 px-3 py-2 bg-purple-500/10 border border-purple-500/30 rounded-lg">
              <span className="text-purple-300 text-sm">🔄</span>
              <div className="flex-1 text-sm text-purple-300">
                Ressource hebdomadaire · <strong>{weeklyRuns} runs/semaine</strong> · Reset le {dayLabels[resetDay]}
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-1 pl-1">
              Ces paramètres sont hérités de l'inventaire. Modifiez l'objet dans l'inventaire pour les changer.
            </p>
          </div>
        ) : selectedItem ? null : null}

        <button
          type="submit"
          disabled={!selectedItem}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2 rounded-lg transition-colors"
        >
          {editingResource ? 'Mettre a jour' : 'Ajouter'}
        </button>
      </form>
    );
  };

  // Inventory Item Form Component
  const InventoryItemForm = () => {
    const game = currentGame;
    const resourceTypes = game?.resourceTypes || defaultResourceTypes;
    const energyLabel = game?.energyName ? `Cout en ${game.energyName}` : 'Cout en energie';

    const [name, setName] = useState(editingInventoryItem?.name || '');
    const [type, setType] = useState(editingInventoryItem?.type || pendingInventoryType || resourceTypes[0]);
    const [icon, setIcon] = useState(editingInventoryItem?.icon || '📦');
    const [imageUrl, setImageUrl] = useState(editingInventoryItem?.imageUrl || '');
    const [owned, setOwned] = useState(editingInventoryItem?.owned || 0);
    const [energyCost, setEnergyCost] = useState(editingInventoryItem?.energyCost ?? 0);
    const [dropRate, setDropRate] = useState(editingInventoryItem?.dropRate ?? 0);
    const [farmLocation, setFarmLocation] = useState(editingInventoryItem?.farmLocation || '');
    const [daysAvailable, setDaysAvailable] = useState<DayOfWeek[]>(editingInventoryItem?.daysAvailable || []);
    const [isWeekly, setIsWeekly] = useState(!!(editingInventoryItem?.weeklyRuns && editingInventoryItem.weeklyRuns > 0));
    const [weeklyRuns, setWeeklyRuns] = useState(editingInventoryItem?.weeklyRuns || 3);
    const [resetDay, setResetDay] = useState<DayOfWeek>(editingInventoryItem?.resetDay || 'mon');

    const toggleDay = (day: DayOfWeek) => {
      setDaysAvailable((prev) =>
        prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
      );
    };

    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSaveInventoryItem({
            name, type, icon, imageUrl, owned, energyCost, dropRate, farmLocation, daysAvailable,
            weeklyRuns: isWeekly ? weeklyRuns : undefined,
            resetDay: isWeekly ? resetDay : undefined,
          });
        }}
        className="space-y-4"
      >
        <div>
          <label className="block text-sm text-slate-400 mb-1">Nom de l'objet</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500"
            required
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm text-slate-400 mb-1">Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500"
            >
              {resourceTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Icone</label>
            <input
              type="text"
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 text-xl focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm text-slate-400 mb-1 flex items-center gap-2">
            <ImageIcon className="w-4 h-4" />
            URL de l'image (optionnel)
          </label>
          <input
            type="url"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500"
            placeholder="https://i.imgur.com/..."
          />
          {imageUrl && (
            <div className="mt-2 flex justify-center">
              <img
                src={imageUrl}
                alt="Preview"
                className="w-12 h-12 object-contain rounded-lg border border-slate-600"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm text-slate-400 mb-1">Quantite possedee</label>
            <input
              type="number"
              value={owned}
              onChange={(e) => setOwned(parseInt(e.target.value) || 0)}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500"
              min={0}
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">{energyLabel}</label>
            <input
              type="number"
              value={energyCost}
              onChange={(e) => setEnergyCost(parseFloat(e.target.value) || 0)}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500"
              min={0}
              step={0.5}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm text-slate-400 mb-1">Taux de drop (%)</label>
            <input
              type="number"
              value={dropRate}
              onChange={(e) => setDropRate(parseFloat(e.target.value) || 0)}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500"
              min={0}
              max={100}
              step={0.1}
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Lieu de farm</label>
            <input
              type="text"
              value={farmLocation}
              onChange={(e) => setFarmLocation(e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500"
              placeholder="Donjon, zone..."
            />
          </div>
        </div>
        <div>
          <label className="block text-sm text-slate-400 mb-1">Jours de disponibilite</label>
          <div className="flex flex-wrap gap-1.5">
            {(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as DayOfWeek[]).map((day) => (
              <button
                key={day}
                type="button"
                onClick={() => toggleDay(day)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  daysAvailable.includes(day)
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                }`}
              >
                {dayLabels[day]}
              </button>
            ))}
          </div>
        </div>

        {/* Weekly Runs — pre-configured here so it's auto-filled when assigned to a character */}
        <div className="border-t border-slate-700 pt-4">
          <label className="flex items-center gap-2 text-sm text-slate-300 mb-3 cursor-pointer">
            <input
              type="checkbox"
              checked={isWeekly}
              onChange={(e) => setIsWeekly(e.target.checked)}
              className="rounded border-slate-600 bg-slate-700 text-blue-500 focus:ring-blue-500"
            />
            <span>Ressource hebdomadaire (runs limités/semaine)</span>
          </label>
          {isWeekly && (
            <div className="grid grid-cols-2 gap-3 pl-6 animate-fade-in">
              <div>
                <label className="block text-sm text-slate-500 mb-1">Runs max / semaine</label>
                <input
                  type="number"
                  value={weeklyRuns}
                  onChange={(e) => setWeeklyRuns(parseInt(e.target.value) || 1)}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500"
                  min={1}
                  max={99}
                />
              </div>
              <div>
                <label className="block text-sm text-slate-500 mb-1">Jour de reset</label>
                <select
                  value={resetDay}
                  onChange={(e) => setResetDay(e.target.value as DayOfWeek)}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500"
                >
                  <option value="mon">Lundi</option>
                  <option value="tue">Mardi</option>
                  <option value="wed">Mercredi</option>
                  <option value="thu">Jeudi</option>
                  <option value="fri">Vendredi</option>
                  <option value="sat">Samedi</option>
                  <option value="sun">Dimanche</option>
                </select>
              </div>
            </div>
          )}
        </div>

        <button
          type="submit"
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 rounded-lg transition-colors"
        >
          {editingInventoryItem ? 'Mettre a jour' : 'Ajouter'}
        </button>
      </form>
    );
  };

  // Resource Types Modal
  const ResourceTypesModal = () => {
    const game = currentGame;
    if (!game) return null;

    return (
      <Modal
        isOpen={showResourceTypesModal}
        onClose={() => {
          setShowResourceTypesModal(false);
          setNewResourceType('');
        }}
        title="Gerer les types de ressources"
      >
        <div className="space-y-4">
          <div className="space-y-2">
            {game.resourceTypes.map((type) => (
              <div
                key={type}
                className="flex items-center justify-between bg-slate-700 rounded-lg px-3 py-2"
              >
                <span className="text-slate-200">{type}</span>
                <button
                  onClick={() => handleRemoveResourceType(type)}
                  className="p-1 hover:bg-red-500/20 rounded text-slate-400 hover:text-red-400 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={newResourceType}
              onChange={(e) => setNewResourceType(e.target.value)}
              placeholder="Nouveau type..."
              className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500"
            />
            <button
              onClick={() => {
                if (newResourceType.trim()) {
                  handleAddResourceType(newResourceType.trim());
                  setNewResourceType('');
                }
              }}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
          <button
            onClick={() => {
              setShowResourceTypesModal(false);
              setNewResourceType('');
            }}
            className="w-full px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg transition-colors"
          >
            Fermer
          </button>
        </div>
      </Modal>
    );
  };

  // Level Modal
  const LevelModal = () => {
    if (!currentCharacter) return null;

    return (
      <Modal
        isOpen={showLevelModal}
        onClose={() => setShowLevelModal(false)}
        title="Modifier le niveau"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1">Niveau actuel</label>
            <input
              type="number"
              value={newLevel}
              onChange={(e) => setNewLevel(parseInt(e.target.value) || 1)}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500"
              min={1}
              max={currentCharacter.targetLevel}
            />
          </div>
          <div className="flex gap-2">
            {[
              currentCharacter.currentLevel,
              Math.min(currentCharacter.currentLevel + 10, currentCharacter.targetLevel),
              currentCharacter.targetLevel,
            ].filter((v, i, arr) => arr.indexOf(v) === i).map((level) => (
              <button
                key={level}
                onClick={() => setNewLevel(level)}
                className={`flex-1 py-2 rounded-lg border transition-colors ${
                  newLevel === level
                    ? 'bg-blue-600 border-blue-500 text-white'
                    : 'bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600'
                }`}
              >
                {level}
              </button>
            ))}
          </div>
          <button
            onClick={() => handleUpdateLevel(currentCharacter.id, newLevel)}
            className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
          >
            Valider
          </button>
        </div>
      </Modal>
    );
  };

  // Render Dashboard
  const renderDashboard = () => {
    const todayResources = getTodayResources();

    // Calculate inventory allocations per game
    const gameAllocations = new Map<string, Map<string, number>>();
    data.games.forEach(game => {
      gameAllocations.set(game.id, calculateInventoryAllocation(game));
    });

    // Count resources that still need farming (after inventory allocation)
    const remainingResources = todayResources.filter(({ resource, game }) => {
      const allocation = gameAllocations.get(game.id) || new Map();
      return getRemainingToFarm(resource, game, allocation) > 0;
    }).length;

    const uniqueCharacters = new Set(todayResources.map((r) => r.character.id)).size;
    const overallProgress = getOverallProgress(data);

    // Calculate energy per game — iterate ALL games/resources with remaining to farm
    const energyByGame = new Map<string, { label: string; total: number; gameColor: string }>();
    data.games.forEach(game => {
      const allocation = gameAllocations.get(game.id) || new Map();
      game.characters.forEach(character => {
        character.resources.forEach(resource => {
          const remaining = getRemainingToFarm(resource, game, allocation);
          if (remaining > 0 && resource.energyCost > 0) {
            const runsNeeded = resource.dropRate > 0
              ? Math.ceil(remaining / (resource.dropRate / 100))
              : remaining;
            const label = game.energyName?.trim() || 'Énergie';
            const key = game.id; // one entry per game
            const prev = energyByGame.get(key);
            if (prev) {
              prev.total += runsNeeded * resource.energyCost;
            } else {
              energyByGame.set(key, { label, total: runsNeeded * resource.energyCost, gameColor: game.color });
            }
          }
        });
      });
    });
    const totalEnergyEstimated = Array.from(energyByGame.values()).reduce((s, e) => s + e.total, 0);

    // Resources with limited availability windows — grouped by inventoryItemId (or resource name)
    // so identical resources needed by multiple characters appear on a single line
    const today = getTodayDay();
    const tomorrowIdx = (new Date().getDay() + 1) % 7;
    const tomorrowDay = (['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as DayOfWeek[])[tomorrowIdx];

    type AlertGroup = {
      key: string;
      resource: Resource;
      game: Game;
      characters: Character[];
      totalRemaining: number;
      availToday: boolean;
      availTomorrow: boolean;
    };
    const alertGroupMap = new Map<string, AlertGroup>();

    data.games.forEach(game => {
      const allocation = gameAllocations.get(game.id) || new Map();
      game.characters.forEach(character => {
        character.resources.forEach(resource => {
          if (resource.daysAvailable.includes('any')) return;
          if (resource.weeklyRuns && resource.weeklyRuns > 0) return;
          const remaining = getRemainingToFarm(resource, game, allocation);
          if (remaining <= 0) return;

          // Group key: same inventory item within same game = same row
          const groupKey = resource.inventoryItemId
            ? `${game.id}::${resource.inventoryItemId}`
            : `${game.id}::name::${resource.name.toLowerCase()}`;

          const availToday = resource.daysAvailable.includes(today);
          const availTomorrow = resource.daysAvailable.includes(tomorrowDay);

          if (alertGroupMap.has(groupKey)) {
            const g = alertGroupMap.get(groupKey)!;
            g.characters.push(character);
            g.totalRemaining += remaining;
          } else {
            alertGroupMap.set(groupKey, {
              key: groupKey,
              resource,
              game,
              characters: [character],
              totalRemaining: remaining,
              availToday,
              availTomorrow,
            });
          }
        });
      });
    });
    const farmTomorrowAlerts = Array.from(alertGroupMap.values())
      // Sort: today-only first (most urgent), then today+tomorrow, then tomorrow only, then other days
      .sort((a, b) => {
        const urgencyScore = (g: AlertGroup) =>
          g.availToday && !g.availTomorrow ? 0
          : g.availToday ? 1
          : g.availTomorrow ? 2
          : 3;
        return urgencyScore(a) - urgencyScore(b);
      });

    // Group by game, then by character
    const groupedByGame = new Map<Game, Map<Character, typeof todayResources>>();

    todayResources.forEach(({ game, character, resource }) => {
      if (!groupedByGame.has(game)) {
        groupedByGame.set(game, new Map());
      }
      const gameMap = groupedByGame.get(game)!;
      if (!gameMap.has(character)) {
        gameMap.set(character, []);
      }
      gameMap.get(character)!.push({ game, character, resource });
    });

    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent flex items-center gap-2">
                <Gamepad2 className="w-6 h-6 text-blue-400" />
                Tableau de farm
              </h1>
              <p className="text-slate-400 mt-1">
                <span className="text-orange-400 font-medium">{remainingResources}</span> ressource{remainingResources > 1 ? 's' : ''} à farmer sur <span className="text-blue-400 font-medium">{uniqueCharacters}</span> personnage{uniqueCharacters > 1 ? 's' : ''}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setHideCompleted(!hideCompleted)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-all ${
                  hideCompleted
                    ? 'bg-blue-600/20 text-blue-400 border border-blue-500/50'
                    : 'bg-slate-800/50 text-slate-400 hover:text-slate-200 border border-slate-700/50'
                }`}
              >
                {hideCompleted ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                {hideCompleted ? 'Voir terminees' : 'Cacher terminees'}
              </button>
              {todayResources.length > 0 && (
                <button
                  onClick={() => setShowFarmAllConfirm(true)}
                  className="btn-success flex items-center gap-2"
                >
                  <Check className="w-4 h-4" />
                  Tout farmer
                </button>
              )}
            </div>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Overall Progress */}
            <div className="card p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-slate-400 text-sm">Progression globale</span>
                <span className="text-2xl font-bold" style={{ color: overallProgress === 100 ? '#22c55e' : '#3b82f6' }}>
                  {overallProgress}%
                </span>
              </div>
              <ProgressBar percentage={overallProgress} color={overallProgress === 100 ? '#22c55e' : '#3b82f6'} size="md" />
            </div>

            {/* Energy estimated — one line per game with its custom energy name */}
            {totalEnergyEstimated > 0 && (
              <div className="card p-4 border-blue-500/30">
                <div className="flex items-center gap-2 text-slate-400 mb-2">
                  <Sparkles className="w-4 h-4 text-blue-400" />
                  <span className="text-sm">Énergie estimée</span>
                </div>
                <div className="space-y-1">
                  {Array.from(energyByGame.values()).map(({ label, total, gameColor }, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <span className="text-xs text-slate-400">{label}</span>
                      <span className="text-lg font-bold" style={{ color: gameColor }}>{total}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Today's Day */}
            <div className="card p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-slate-400">
                  <Calendar className="w-4 h-4" />
                  <span className="text-sm">Jour actuel</span>
                </div>
                <span className="text-lg font-semibold text-slate-200 capitalize">
                  {dayLabels[getTodayDay()]}
                </span>
              </div>
            </div>
          </div>

          {/* Farm Availability Alert — limited-day resources still needed, grouped by item */}
          {farmTomorrowAlerts.length > 0 && (
            <div className="card border-orange-500/40 bg-gradient-to-r from-orange-500/10 to-transparent p-4">
              <div className="flex items-center gap-2 text-orange-400 mb-3">
                <AlertTriangle className="w-5 h-5" />
                <span className="font-medium">Ressources à disponibilité limitée ({farmTomorrowAlerts.length})</span>
              </div>
              <div className="space-y-2">
                {farmTomorrowAlerts.map(({ key, resource, characters, totalRemaining, availToday, availTomorrow }) => {
                  const urgency = availToday && !availTomorrow
                    ? { label: 'Dernière chance aujourd\'hui !', color: 'text-red-400' }
                    : availToday
                    ? { label: 'Dispo aujourd\'hui', color: 'text-green-400' }
                    : availTomorrow
                    ? { label: 'Pas dispo aujourd\'hui — dispo demain', color: 'text-yellow-400' }
                    : { label: `Jours : ${resource.daysAvailable.map(d => dayLabels[d]).join(', ')}`, color: 'text-slate-400' };
                  return (
                    <div key={key} className="flex items-center gap-2 text-sm flex-wrap">
                      {resource.imageUrl ? (
                        <img src={resource.imageUrl} alt={resource.name} className="w-4 h-4 object-contain rounded flex-shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      ) : (
                        <span className="flex-shrink-0">{resource.icon}</span>
                      )}
                      <span className="text-slate-300 font-medium">{resource.name}</span>
                      <span className="text-slate-600">·</span>
                      <span className="text-slate-400 text-xs">
                        {characters.map(c => c.name).join(', ')}
                      </span>
                      <span className="text-slate-600">·</span>
                      <span className="text-orange-300">{totalRemaining} restants</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded bg-slate-800 ${urgency.color}`}>
                        {urgency.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Resources */}
        {todayResources.length === 0 ? (
          <div className="text-center py-12">
            <Package className="w-16 h-16 mx-auto text-slate-600 mb-4" />
            <p className="text-slate-400">Aucune ressource à farmer !</p>
            <p className="text-slate-500 text-sm mt-1">
              Ajoutez des jeux et des personnages pour commencer à suivre vos objectifs.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {Array.from(groupedByGame.entries()).map(([game, characterMap]) => {
              const gameProgress = getGameProgress(game);
              const gameImage = game.imageUrl ? (
                <img
                  src={game.imageUrl}
                  alt={game.name}
                  className="w-8 h-8 object-contain rounded"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              ) : (
                <span className="text-2xl">{game.icon}</span>
              );

              return (
                <div key={game.id} className="space-y-4">
                  <div
                    className="flex items-center gap-2 pb-2 border-b"
                    style={{ borderColor: game.color }}
                  >
                    {gameImage}
                    <h2 className="text-lg font-semibold" style={{ color: game.color }}>
                      {game.name}
                    </h2>
                    <span className="text-sm text-slate-500 ml-2">({gameProgress}%)</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {Array.from(characterMap.entries()).map(([character, resources]) => {
                    const gameAlloc = gameAllocations.get(game.id) || new Map();
                    const charProgress = getCharacterProgress(character, gameAlloc);
                    const incompleteResources = resources.filter(({ resource }) => {
                      return getRemainingToFarm(resource, game, gameAlloc) > 0;
                    });

                    return (
                      <div
                        key={character.id}
                        className="card p-4 cursor-pointer group"
                        onClick={() => {
                          setSelectedGameId(game.id);
                          setSelectedCharacterId(character.id);
                          setCurrentView('character-detail');
                        }}
                      >
                        {/* Character Header */}
                        <div className="flex items-center gap-3 mb-3">
                          <div className="relative">
                            {character.imageUrl ? (
                              <img
                                src={character.imageUrl}
                                alt={character.name}
                                className="w-12 h-12 rounded-xl object-cover border-2 border-slate-600 group-hover:border-blue-500 transition-colors"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display = 'none';
                                }}
                              />
                            ) : (
                              <div className="w-12 h-12 rounded-xl bg-slate-700 flex items-center justify-center text-2xl border-2 border-slate-600 group-hover:border-blue-500 transition-colors">
                                {character.image}
                              </div>
                            )}
                            <div
                              className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold border-2 border-slate-800"
                              style={{
                                backgroundColor: character.priority === 'high' ? '#ef4444' : character.priority === 'medium' ? '#f59e0b' : '#3b82f6',
                              }}
                            >
                              {character.priority === 'high' ? '!' : character.priority === 'medium' ? '2' : '3'}
                            </div>
                          </div>
                          <div className="flex-1">
                            <h3 className="font-semibold text-slate-100 group-hover:text-blue-400 transition-colors">
                              {character.name}
                            </h3>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-xs text-slate-500">{character.element}</span>
                              <span className="text-slate-600">•</span>
                              <span className={`text-xs font-medium ${incompleteResources.length === 0 ? 'text-green-400' : 'text-orange-400'}`}>
                                {incompleteResources.length === 0 ? 'Complet' : `${incompleteResources.length} restante${incompleteResources.length > 1 ? 's' : ''}`}
                              </span>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-lg font-bold" style={{ color: game.color }}>
                              {charProgress}%
                            </div>
                            <div className="w-16 h-2 bg-slate-700 rounded-full overflow-hidden">
                              <div
                                className="h-full transition-all duration-300 rounded-full"
                                style={{
                                  width: `${charProgress}%`,
                                  backgroundColor: charProgress === 100 ? '#22c55e' : game.color,
                                }}
                              />
                            </div>
                          </div>
                        </div>

                        {/* Resources Preview - with image, inline edit — show ALL resources */}
                        <div className="flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
                          {resources.map(({ resource }) => {
                            const allocation = gameAllocations.get(game.id) || new Map();
                            const effectiveOwned = getEffectiveOwned(resource, allocation);
                            const isComplete = effectiveOwned >= resource.needed;
                            const remaining = getRemainingToFarm(resource, game, allocation);
                            const isEditing =
                              inlineEditResourceId === resource.id &&
                              inlineEditGameId === game.id &&
                              inlineEditCharacterId === character.id;

                            // Get current inventory.owned for this resource
                            const invItem = resource.inventoryItemId
                              ? game.inventory.find(i => i.id === resource.inventoryItemId)
                              : undefined;
                            const invOwned = invItem?.owned ?? resource.owned;

                            return (
                              <div
                                key={resource.id}
                                className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs transition-colors ${
                                  isComplete
                                    ? 'bg-green-500/10 text-green-400 border border-green-500/30'
                                    : 'bg-slate-700/50 text-slate-300 border border-slate-600/50'
                                }`}
                              >
                                {resource.imageUrl ? (
                                  <img
                                    src={resource.imageUrl}
                                    alt={resource.name}
                                    className="w-5 h-5 object-contain rounded flex-shrink-0"
                                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                  />
                                ) : (
                                  <span className="text-base leading-none flex-shrink-0">{resource.icon}</span>
                                )}

                                <span className="truncate max-w-[70px]">{resource.name}</span>

                                {isComplete ? (
                                  <Check className="w-3 h-3 flex-shrink-0" />
                                ) : isEditing ? (
                                  <input
                                    type="number"
                                    value={inlineEditValue}
                                    onChange={(e) => setInlineEditValue(e.target.value)}
                                    onBlur={() => {
                                      if (inlineEditValue !== '') {
                                        handleUpdateResourceOwned(game.id, character.id, resource.id, parseInt(inlineEditValue) || 0);
                                      }
                                      setInlineEditResourceId(null);
                                      setInlineEditGameId(null);
                                      setInlineEditCharacterId(null);
                                      setInlineEditValue('');
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        if (inlineEditValue !== '') {
                                          handleUpdateResourceOwned(game.id, character.id, resource.id, parseInt(inlineEditValue) || 0);
                                        }
                                        setInlineEditResourceId(null);
                                        setInlineEditGameId(null);
                                        setInlineEditCharacterId(null);
                                        setInlineEditValue('');
                                      }
                                      if (e.key === 'Escape') {
                                        setInlineEditResourceId(null);
                                        setInlineEditGameId(null);
                                        setInlineEditCharacterId(null);
                                        setInlineEditValue('');
                                      }
                                    }}
                                    className="w-12 bg-slate-600 border border-blue-500 rounded px-1 text-slate-200 text-xs focus:outline-none"
                                    autoFocus
                                    min={0}
                                  />
                                ) : (
                                  <button
                                    onClick={() => {
                                      setInlineEditGameId(game.id);
                                      setInlineEditCharacterId(character.id);
                                      setInlineEditResourceId(resource.id);
                                      // Edit inventory.owned, not resource.owned
                                      setInlineEditValue(invOwned.toString());
                                    }}
                                    className="font-medium text-orange-400 hover:text-orange-300 transition-colors tabular-nums flex-shrink-0 hover:underline"
                                    title={`En stock: ${invOwned} / Nécessaire: ${resource.needed} — Cliquer pour modifier l'inventaire`}
                                  >
                                    {remaining}
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Weekly Resources Section */}
        {(() => {
          // Deduplicate weekly resources by inventoryItemId.
          // Multiple characters can share the same weekly boss — we show one card with aggregated info.
          type WeeklyGroup = {
            inventoryItemId: string;
            itemName: string;
            itemIcon: string;
            itemImageUrl?: string;
            weeklyRuns: number;
            resetDay: DayOfWeek;
            // One entry per character that uses this weekly resource
            entries: Array<{ game: Game; character: Character; resource: Resource }>;
          };

          const groupMap = new Map<string, WeeklyGroup>();
          const resetsNeeded: Array<{ gameId: string; characterId: string; resourceId: string }> = [];

          data.games.forEach(game => {
            game.characters.forEach(character => {
              character.resources.forEach(resource => {
                if (!resource.weeklyRuns || resource.weeklyRuns <= 0) return;

                // Check reset
                const lastReset = resource.lastResetDate ? new Date(resource.lastResetDate) : null;
                const resetDayNum = resource.resetDay
                  ? ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(resource.resetDay)
                  : 1;
                const now = new Date();
                let needReset = false;
                if (!lastReset) {
                  needReset = true;
                } else {
                  const daysSince = Math.floor((now.getTime() - lastReset.getTime()) / (1000 * 60 * 60 * 24));
                  if (daysSince >= 7) {
                    needReset = true;
                  } else {
                    for (let d = new Date(lastReset.getTime() + 86400000); d <= now; d.setDate(d.getDate() + 1)) {
                      if (d.getDay() === resetDayNum) { needReset = true; break; }
                    }
                  }
                }
                if (needReset && (resource.runsDone ?? 0) > 0) {
                  resetsNeeded.push({ gameId: game.id, characterId: character.id, resourceId: resource.id });
                }

                // Group key: use inventoryItemId if set, else resource name+game
                const groupKey = resource.inventoryItemId
                  ? `${game.id}::${resource.inventoryItemId}`
                  : `${game.id}::name::${resource.name.toLowerCase()}`;

                if (!groupMap.has(groupKey)) {
                  // Find inventory item for display info
                  const invItem = resource.inventoryItemId
                    ? game.inventory.find(i => i.id === resource.inventoryItemId)
                    : undefined;
                  groupMap.set(groupKey, {
                    inventoryItemId: groupKey,
                    itemName: invItem?.name || resource.name,
                    itemIcon: invItem?.icon || resource.icon,
                    itemImageUrl: invItem?.imageUrl || resource.imageUrl,
                    weeklyRuns: resource.weeklyRuns,
                    resetDay: resource.resetDay || 'mon',
                    entries: [],
                  });
                }
                groupMap.get(groupKey)!.entries.push({ game, character, resource });
              });
            });
          });

          // Persist resets
          if (resetsNeeded.length > 0) {
            const today = new Date().toISOString().split('T')[0];
            setTimeout(() => {
              const updatedGames = data.games.map(g => ({
                ...g,
                characters: g.characters.map(c => ({
                  ...c,
                  resources: c.resources.map(r => {
                    const needsReset = resetsNeeded.some(
                      nr => nr.gameId === g.id && nr.characterId === c.id && nr.resourceId === r.id
                    );
                    return needsReset ? { ...r, runsDone: 0, lastResetDate: today } : r;
                  }),
                })),
              }));
              saveData({ ...data, games: updatedGames });
            }, 0);
          }

          const groups = Array.from(groupMap.values());
          if (groups.length === 0) return null;

          const getDaysUntilReset = (resetDay: DayOfWeek): number => {
            const resetDayNum = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(resetDay);
            const currentDay = new Date().getDay();
            let daysUntil = resetDayNum - currentDay;
            if (daysUntil <= 0) daysUntil += 7;
            return daysUntil;
          };

          return (
            <div className="space-y-4 mt-8">
              <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
                <Calendar className="w-5 h-5 text-purple-400" />
                Runs Hebdomadaires
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {groups.map((group) => {
                  // Runs done = max across all entries (they share the same boss)
                  const runsDone = Math.max(...group.entries.map(e => e.resource.runsDone || 0));
                  const maxRuns = group.weeklyRuns;
                  const percentage = Math.min(100, maxRuns > 0 ? (runsDone / maxRuns) * 100 : 0);
                  const daysUntilReset = getDaysUntilReset(group.resetDay);

                  return (
                    <div
                      key={group.inventoryItemId}
                      className="bg-slate-800 rounded-xl border border-slate-700 p-4 animate-fade-in"
                    >
                      <div className="flex items-center gap-2 mb-3">
                        {group.itemImageUrl ? (
                          <img src={group.itemImageUrl} alt={group.itemName} className="w-8 h-8 object-contain rounded" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                        ) : (
                          <span className="text-xl">{group.itemIcon}</span>
                        )}
                        <div className="flex-1">
                          <h3 className="font-medium text-slate-100">{group.itemName}</h3>
                          <p className="text-xs text-slate-500">
                            {group.entries.map(e => e.character.name).join(', ')}
                          </p>
                        </div>
                      </div>

                      <div className="mb-3">
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-sm text-slate-400">Runs effectués</span>
                          <span className={`font-medium ${runsDone >= maxRuns ? 'text-green-400' : runsDone > 0 ? 'text-orange-400' : 'text-red-400'}`}>
                            {runsDone}/{maxRuns}
                          </span>
                        </div>
                        <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all duration-300 ${runsDone >= maxRuns ? 'bg-green-500' : runsDone > 0 ? 'bg-orange-500' : 'bg-red-500'}`}
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-500">
                          Reset {daysUntilReset === 0 ? "aujourd'hui" : daysUntilReset === 1 ? 'demain' : `dans ${daysUntilReset} jours`}
                        </span>
                        {runsDone < maxRuns && (
                          <button
                            onClick={() => {
                              // Update runsDone on all entries sharing this boss
                              group.entries.forEach(({ game, character, resource }) => {
                                handleUpdateRunsDone(game.id, character.id, resource.id, runsDone + 1);
                              });
                            }}
                            className="flex items-center gap-1 px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded transition-colors"
                          >
                            <Plus className="w-3 h-3" />
                            Run
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}
      </div>
    );
  };

  // Render Games List
  const renderGamesList = () => {
    const overallProgress = getOverallProgress(data);

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-100">Mes Jeux</h1>
          <button
            onClick={() => {
              setEditingGame(null);
              setShowGameModal(true);
            }}
            className="flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Ajouter un jeu
          </button>
        </div>

        {/* Overall Progress */}
        {data.games.length > 0 && (
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
            <div className="flex justify-between items-center mb-2">
              <span className="text-slate-400">Progression globale</span>
              <span className="text-slate-200 font-medium">{overallProgress}%</span>
            </div>
            <ProgressBar percentage={overallProgress} color="#3b82f6" size="lg" />
            <div className="flex justify-between text-xs text-slate-500 mt-2">
              <span>{data.games.reduce((acc, g) => acc + g.characters.length, 0)} personnages</span>
              <span>{data.games.reduce((acc, g) => acc + g.characters.reduce((a, c) => a + c.resources.length, 0), 0)} ressources</span>
            </div>
          </div>
        )}

        {data.games.length === 0 ? (
          <div className="text-center py-12">
            <Gamepad2 className="w-16 h-16 mx-auto text-slate-600 mb-4" />
            <p className="text-slate-400">Aucun jeu ajoute !</p>
            <p className="text-slate-500 text-sm mt-1">
              Cliquez sur "Ajouter un jeu" pour commencer a suivre vos personnages.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {data.games.map((game) => {
              const progress = getGameProgress(game);
              const gameImage = game.imageUrl ? (
                <img
                  src={game.imageUrl}
                  alt={game.name}
                  className="w-10 h-10 object-contain rounded"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              ) : null;

              return (
                <div
                  key={game.id}
                  className="bg-slate-800 rounded-xl border border-slate-700 hover:border-slate-600 transition-all group animate-fade-in overflow-hidden"
                  style={{ borderColor: `${game.color}40`, boxShadow: `0 0 20px ${game.color}15` }}
                >
                  <div className="p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div
                        className="flex items-center gap-3 cursor-pointer flex-1"
                        onClick={() => navigateToGame(game.id)}
                      >
                        {gameImage || <span className="text-3xl">{game.icon}</span>}
                        <div>
                          <h3 className="font-semibold text-slate-100">{game.name}</h3>
                          <p className="text-sm text-slate-400">
                            {game.characters.length} personnage{game.characters.length !== 1 ? 's' : ''}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => {
                            setEditingGame(game);
                            setShowGameModal(true);
                          }}
                          className="p-1.5 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-slate-200 transition-colors"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() =>
                            setShowDeleteConfirm({ type: 'game', id: game.id, name: game.name })
                          }
                          className="p-1.5 hover:bg-red-500/20 rounded-lg text-slate-400 hover:text-red-400 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-400">Progression</span>
                        <span className="text-slate-200 font-medium">{progress}%</span>
                      </div>
                      <ProgressBar percentage={progress} color={game.color} />
                      <div className="flex justify-between text-xs text-slate-500">
                        <span>{game.characters.reduce((a, c) => a + c.resources.length, 0)} ressources</span>
                        <span>{game.characters.filter((c) => getCharacterProgress(c, calculateInventoryAllocation(game)) === 100).length} complets</span>
                      </div>
                    </div>
                    {/* Inventory button */}
                    <button
                      onClick={() => {
                        setSelectedGameId(game.id);
                        setCurrentView('inventory');
                      }}
                      className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg transition-colors text-sm"
                    >
                      <Warehouse className="w-4 h-4" />
                      Inventaire ({game.inventory.length})
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  // Render Inventory
  const renderInventory = () => {
    if (!currentGame) return null;

    const inventoryItems = currentGame.inventory;
    const resourceTypes = currentGame.resourceTypes || defaultResourceTypes;

    // Group items by type
    const groupedItems = inventoryItems.reduce((acc, item) => {
      if (!acc[item.type]) acc[item.type] = [];
      acc[item.type].push(item);
      return acc;
    }, {} as Record<string, InventoryItem[]>);

    const sortedTypes = Object.keys(groupedItems).sort((a, b) => a.localeCompare(b));

    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <button
            onClick={navigateBack}
            className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-200 transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-3">
            {currentGame.imageUrl ? (
              <img
                src={currentGame.imageUrl}
                alt={currentGame.name}
                className="w-10 h-10 object-contain rounded"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            ) : (
              <span className="text-3xl">{currentGame.icon}</span>
            )}
            <div>
              <h1 className="text-2xl font-bold" style={{ color: currentGame.color }}>
                Inventaire - {currentGame.name}
              </h1>
              <p className="text-slate-400">
                {inventoryItems.length} objet{inventoryItems.length !== 1 ? 's' : ''} en stock
              </p>
            </div>
          </div>
        </div>

        {/* Info card */}
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
          <div className="flex items-start gap-3">
            <Link2 className="w-5 h-5 text-blue-400 mt-0.5" />
            <div>
              <p className="text-slate-200 font-medium">Comment ca marche ?</p>
              <p className="text-sm text-slate-400 mt-1">
                Ajoutez les ressources que vous possedez ici. L'application soustraira automatiquement
                les besoins de vos personnages pour vous montrer ce qu'il reste reellement a farmer.
              </p>
            </div>
          </div>
        </div>

        {/* Resource Types Manager — add, rename, delete, quick-add */}
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium text-slate-300">Types de ressources</p>
            <p className="text-xs text-slate-500">Cliquez sur un nom pour le renommer · + pour ajouter un objet</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {resourceTypes.map((type) => {
              const itemCount = currentGame.inventory.filter(i => i.type === type).length;
              return (
                <div key={type} className="group flex items-center gap-0 bg-slate-700 rounded-lg overflow-hidden border border-slate-600 hover:border-slate-500 transition-colors">
                  {/* Rename inline */}
                  <span
                    className="px-2 py-1.5 text-sm text-slate-200 cursor-text hover:text-white transition-colors"
                    contentEditable
                    suppressContentEditableWarning
                    onBlur={(e) => {
                      const newName = e.currentTarget.textContent?.trim() || '';
                      if (newName && newName !== type) {
                        handleRenameResourceType(type, newName);
                      } else {
                        // Reset to original if empty or unchanged
                        e.currentTarget.textContent = type;
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        e.currentTarget.blur();
                      }
                      if (e.key === 'Escape') {
                        e.currentTarget.textContent = type;
                        e.currentTarget.blur();
                      }
                    }}
                    title="Cliquer pour renommer"
                  >
                    {type}
                  </span>
                  {itemCount > 0 && (
                    <span className="text-xs text-slate-500 pr-1">({itemCount})</span>
                  )}
                  {/* Quick-add button */}
                  <button
                    onClick={() => {
                      setEditingInventoryItem(null);
                      setShowInventoryModal(true);
                      setPendingInventoryType(type);
                    }}
                    className="px-2 py-1.5 text-slate-400 hover:text-blue-400 hover:bg-blue-500/10 transition-colors border-l border-slate-600"
                    title={`Ajouter un objet de type ${type}`}
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                  {/* Delete button */}
                  <button
                    onClick={() => handleRemoveResourceType(type)}
                    className="px-1.5 py-1.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100"
                    title={`Supprimer le type ${type}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              );
            })}

            {/* Add new type */}
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={newResourceType}
                onChange={(e) => setNewResourceType(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newResourceType.trim()) {
                    handleAddResourceType(newResourceType.trim());
                    setNewResourceType('');
                  }
                }}
                placeholder="Nouveau type..."
                className="w-32 bg-slate-700 border border-dashed border-slate-600 rounded-lg px-2 py-1.5 text-sm text-slate-300 placeholder-slate-600 focus:outline-none focus:border-blue-500 focus:placeholder-slate-500"
              />
              {newResourceType.trim() && (
                <button
                  onClick={() => {
                    handleAddResourceType(newResourceType.trim());
                    setNewResourceType('');
                  }}
                  className="p-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Inventory List grouped by type */}
        {inventoryItems.length === 0 ? (
          <div className="text-center py-12 bg-slate-800 rounded-xl border border-slate-700">
            <Warehouse className="w-16 h-16 mx-auto text-slate-600 mb-4" />
            <p className="text-slate-400">Inventaire vide !</p>
            <p className="text-slate-500 text-sm mt-1">
              Ajoutez des objets pour suivre votre stock et optimiser votre farm.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {sortedTypes.map((type) => (
              <div key={type}>
                {/* Type separator header */}
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-px flex-1 bg-gradient-to-r from-slate-700 to-transparent" />
                  <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider px-3 py-1 bg-slate-800 rounded-full border border-slate-700">
                    {type}
                    <span className="ml-2 text-xs text-slate-500 font-normal">
                      {groupedItems[type].length} objet{groupedItems[type].length > 1 ? 's' : ''}
                    </span>
                  </h3>
                  <div className="h-px flex-1 bg-gradient-to-l from-slate-700 to-transparent" />
                </div>

                {/* Items in this type */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {groupedItems[type].map((item) => {
                    const status = getInventoryItemStatus(currentGame, item);

                    const itemImage = item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        alt={item.name}
                        className="w-10 h-10 object-contain rounded"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    ) : null;

                    return (
                      <div
                        key={item.id}
                        className="bg-slate-800 rounded-xl border border-slate-700 p-4 group hover:border-slate-600 transition-colors"
                      >
                        <div className="flex items-start gap-3">
                          {itemImage || <span className="text-2xl">{item.icon}</span>}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-slate-100">{item.name}</span>
                            </div>
                            {/* Farm info */}
                            {(item.farmLocation || item.energyCost || item.dropRate) && (
                              <div className="flex flex-wrap gap-2 mt-1 text-xs text-slate-500">
                                {item.farmLocation && <span>📍 {item.farmLocation}</span>}
                                {item.energyCost ? <span>⚡ {item.energyCost}</span> : null}
                                {item.dropRate ? <span>📊 {item.dropRate}%</span> : null}
                              </div>
                            )}
                            {/* Days available */}
                            {item.daysAvailable && item.daysAvailable.length > 0 && !item.daysAvailable.includes('any') && (
                              <div className="flex flex-wrap gap-1 mt-1.5">
                                {item.daysAvailable.map((d) => (
                                  <span key={d} className="text-xs px-1.5 py-0.5 bg-slate-700/50 text-slate-400 rounded">
                                    {dayLabels[d]}
                                  </span>
                                ))}
                              </div>
                            )}
                            <div className="flex items-center gap-2 mt-2">
                              <button
                                onClick={() => handleUpdateInventoryOwned(currentGame.id, item.id, item.owned - 1)}
                                className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-slate-200 transition-colors"
                              >
                                <Minus className="w-3 h-3" />
                              </button>
                              <span className="text-slate-200 font-medium tabular-nums">{item.owned}</span>
                              <button
                                onClick={() => handleUpdateInventoryOwned(currentGame.id, item.id, item.owned + 1)}
                                className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-slate-200 transition-colors"
                              >
                                <Plus className="w-3 h-3" />
                              </button>
                            </div>
                            {status.totalNeeded > 0 && (
                              <div className="mt-1 text-xs space-y-0.5">
                                <p className="text-slate-500">
                                  Besoin total : <span className="text-slate-300">{status.totalNeeded}</span>
                                </p>
                                {status.missing > 0 && (
                                  <p className="text-red-400">
                                    Manquant : {status.missing}
                                  </p>
                                )}
                                {status.surplus > 0 && (
                                  <p className="text-green-400">
                                    Surplus : +{status.surplus}
                                  </p>
                                )}
                                {status.missing === 0 && status.surplus === 0 && (
                                  <p className="text-green-400">✓ Quantité exacte</p>
                                )}
                              </div>
                            )}
                          </div>
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => {
                                setEditingInventoryItem(item);
                                setShowInventoryModal(true);
                              }}
                              className="p-1.5 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-slate-200 transition-colors"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() =>
                                setShowDeleteConfirm({
                                  type: 'inventory',
                                  id: item.id,
                                  name: item.name,
                                })
                              }
                              className="p-1.5 hover:bg-red-500/20 rounded-lg text-slate-400 hover:text-red-400 transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // Render Game Detail
  const renderGameDetail = () => {
    if (!currentGame) return null;

    const filteredCharacters = getFilteredCharacters(currentGame);
    const elements = getGameElements(currentGame);
    const gameAllocation = calculateInventoryAllocation(currentGame);
    const gameProgress = getGameProgress(currentGame, gameAllocation);
    const gameImage = currentGame.imageUrl ? (
      <img
        src={currentGame.imageUrl}
        alt={currentGame.name}
        className="w-12 h-12 object-contain rounded"
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = 'none';
        }}
      />
    ) : null;

    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <button
            onClick={navigateBack}
            className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-200 transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-3">
            {gameImage || <span className="text-3xl">{currentGame.icon}</span>}
            <div>
              <h1 className="text-2xl font-bold" style={{ color: currentGame.color }}>
                {currentGame.name}
              </h1>
              <p className="text-slate-400">
                {currentGame.characters.length} personnage{currentGame.characters.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              setSelectedGameId(currentGame.id);
              setCurrentView('inventory');
            }}
            className="ml-auto flex items-center gap-2 px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg transition-colors"
          >
            <Warehouse className="w-4 h-4" />
            Inventaire
          </button>
        </div>

        {/* Game Progress */}
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
          <div className="flex justify-between items-center mb-2">
            <span className="text-slate-400">Progression du jeu</span>
            <span className="text-slate-200 font-medium">{gameProgress}%</span>
          </div>
          <ProgressBar percentage={gameProgress} color={currentGame.color} size="lg" />
          <div className="flex justify-between text-xs text-slate-500 mt-2">
            <span>{currentGame.characters.reduce((a, c) => a + c.resources.length, 0)} ressources</span>
            <span>{currentGame.characters.filter((c) => getCharacterProgress(c, gameAllocation) === 100).length} personnages complets</span>
          </div>
          {/* Game custom info */}
          {(currentGame.energyName || currentGame.currencyName || (currentGame.elements && currentGame.elements.length > 0)) && (
            <div className="flex flex-wrap gap-3 mt-3 pt-3 border-t border-slate-700/60">
              {currentGame.energyName && (
                <span className="flex items-center gap-1.5 text-xs text-slate-400">
                  <Sparkles className="w-3 h-3 text-blue-400" />
                  Énergie : <span className="text-blue-300 font-medium">{currentGame.energyName}</span>
                </span>
              )}
              {currentGame.currencyName && (
                <span className="flex items-center gap-1.5 text-xs text-slate-400">
                  <Star className="w-3 h-3 text-yellow-400" />
                  Monnaie : <span className="text-yellow-300 font-medium">{currentGame.currencyName}</span>
                </span>
              )}
              {currentGame.elements && currentGame.elements.length > 0 && (
                <span className="flex items-center gap-1.5 flex-wrap text-xs text-slate-400">
                  Éléments :
                  {currentGame.elements.map((el) => (
                    <span key={el} className="px-1.5 py-0.5 bg-purple-500/20 text-purple-300 rounded text-xs border border-purple-500/20">
                      {el}
                    </span>
                  ))}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-4">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-400" />
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value as Priority | 'all')}
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-200 text-sm focus:outline-none focus:border-blue-500"
            >
              <option value="all">Toutes priorites</option>
              <option value="high">Haute priorite</option>
              <option value="medium">Moyenne priorite</option>
              <option value="low">Basse priorite</option>
            </select>
          </div>
          {elements.length > 1 && (
            <select
              value={elementFilter}
              onChange={(e) => setElementFilter(e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-200 text-sm focus:outline-none focus:border-blue-500"
            >
              <option value="all">Tous elements</option>
              {elements.map((el) => (
                <option key={el} value={el}>
                  {el}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={() => {
              setEditingCharacter(null);
              setShowCharacterModal(true);
            }}
            className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors ml-auto"
          >
            <Plus className="w-4 h-4" />
            Ajouter un personnage
          </button>
        </div>

        {/* Characters Grid */}
        {filteredCharacters.length === 0 ? (
          <div className="text-center py-12">
            <User className="w-16 h-16 mx-auto text-slate-600 mb-4" />
            <p className="text-slate-400">
              {currentGame.characters.length === 0
                ? 'Aucun personnage ajoute !'
                : 'Aucun personnage ne correspond aux filtres.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {filteredCharacters.map((character) => {
              const progress = getCharacterProgress(character, gameAllocation);
              const charImage = character.imageUrl ? (
                <img
                  src={character.imageUrl}
                  alt={character.name}
                  className="w-12 h-12 rounded-lg object-cover border border-slate-600"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              ) : null;

              return (
                <div
                  key={character.id}
                  className="bg-slate-800 rounded-xl border border-slate-700 hover:border-slate-600 transition-all group animate-fade-in overflow-hidden"
                  style={{
                    borderColor: `${currentGame.color}30`,
                  }}
                >
                  <div className="p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div
                        className="cursor-pointer flex-1"
                        onClick={() => navigateToCharacter(character.id)}
                      >
                        <div className="flex items-center gap-3 mb-2">
                          {charImage || <span className="text-3xl">{character.image}</span>}
                          <div>
                            <h3 className="font-semibold text-slate-100">{character.name}</h3>
                            <div className="flex items-center gap-2 mt-0.5">
                              <StarRating rarity={character.rarity} />
                              <span className="text-xs text-slate-400">{character.element}</span>
                            </div>
                          </div>
                        </div>
                        <span
                          className={`text-xs px-2 py-0.5 rounded border ${
                            priorityColors[character.priority]
                          }`}
                        >
                          {priorityLabels[character.priority]}
                        </span>
                      </div>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => {
                            setEditingCharacter(character);
                            setShowCharacterModal(true);
                          }}
                          className="p-1.5 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-slate-200 transition-colors"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() =>
                            setShowDeleteConfirm({
                              type: 'character',
                              id: character.id,
                              name: character.name,
                            })
                          }
                          className="p-1.5 hover:bg-red-500/20 rounded-lg text-slate-400 hover:text-red-400 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-400">
                          Niveau {character.currentLevel} → {character.targetLevel}
                        </span>
                        <span className="text-slate-200 font-medium">{progress}%</span>
                      </div>
                      <ProgressBar percentage={progress} color={currentGame.color} />
                      <div className="flex justify-between text-xs text-slate-500">
                        <span>{character.resources.length} ressources</span>
                        <span>
                          {character.resources.filter((r) => r.owned >= r.needed).length} completees
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  // Render Character Detail
  const renderCharacterDetail = () => {
    if (!currentGame || !currentCharacter) return null;

    const allocation = calculateInventoryAllocation(currentGame);
    const charProgress = getCharacterProgress(currentCharacter, allocation);
    const charImage = currentCharacter.imageUrl ? (
      <img
        src={currentCharacter.imageUrl}
        alt={currentCharacter.name}
        className="w-16 h-16 rounded-xl object-cover border border-slate-600"
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = 'none';
        }}
      />
    ) : null;

    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <button
            onClick={navigateBack}
            className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-200 transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-3">
            {charImage || <span className="text-4xl">{currentCharacter.image}</span>}
            <div>
              <h1 className="text-2xl font-bold text-slate-100">{currentCharacter.name}</h1>
              <div className="flex items-center gap-2 mt-0.5">
                <StarRating rarity={currentCharacter.rarity} />
                <span className="text-slate-400">{currentCharacter.element}</span>
                <span
                  className={`text-xs px-2 py-0.5 rounded border ${
                    priorityColors[currentCharacter.priority]
                  }`}
                >
                  {priorityLabels[currentCharacter.priority]}
                </span>
              </div>
            </div>
            <button
              onClick={() => {
                setEditingCharacter(currentCharacter);
                setShowCharacterModal(true);
              }}
              className="ml-auto p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-200 transition-colors"
            >
              <Edit2 className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Skills/Notes Section */}
        {currentCharacter.skills && (
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
            <div className="flex items-center gap-2 mb-2 text-slate-400">
              <Sparkles className="w-4 h-4" />
              <span className="text-sm font-medium">Competences / Passifs / Notes</span>
            </div>
            <p className="text-slate-200 whitespace-pre-wrap">{currentCharacter.skills}</p>
          </div>
        )}

        {/* Level Progress */}
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
          <div className="flex justify-between items-center mb-2">
            <span className="text-slate-400">Progression de niveau</span>
            <div className="flex items-center gap-2">
              <span className="text-slate-200 font-medium">
                {currentCharacter.currentLevel} → {currentCharacter.targetLevel}
              </span>
              <button
                onClick={() => {
                  setNewLevel(currentCharacter.currentLevel);
                  setShowLevelModal(true);
                }}
                className="p-1.5 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-slate-200 transition-colors"
                title="Modifier le niveau"
              >
                <Edit2 className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="h-3 bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-300 rounded-full"
              style={{
                width: `${
                  ((currentCharacter.currentLevel - 1) / Math.max(1, currentCharacter.targetLevel - 1)) * 100
                }%`,
              }}
            />
          </div>
        </div>

        {/* Resources Progress */}
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
          <div className="flex justify-between items-center mb-2">
            <span className="text-slate-400">Ressources</span>
            <span className="text-slate-200 font-medium">{charProgress}%</span>
          </div>
          <ProgressBar percentage={charProgress} color={currentGame.color} size="lg" />
          <div className="flex justify-between text-xs text-slate-500 mt-2">
            <span>{currentCharacter.resources.length} ressources</span>
            <span>{currentCharacter.resources.filter((r) => r.owned >= r.needed).length} completees</span>
          </div>
        </div>

        {/* Resources Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">
              Ressources ({currentCharacter.resources.length})
            </h2>
            <p className="text-sm text-slate-400">
              {currentCharacter.resources.filter((r) => r.owned >= r.needed).length} completee{currentCharacter.resources.filter((r) => r.owned >= r.needed).length !== 1 ? 's' : ''}
            </p>
          </div>
          <button
            onClick={() => {
              setEditingResource(null);
              setShowResourceModal(true);
            }}
            className="flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Ajouter une ressource
          </button>
        </div>

        {/* Resources List - Grid */}
        {currentCharacter.resources.length === 0 ? (
          <div className="text-center py-12 bg-slate-800 rounded-xl border border-slate-700">
            <Package className="w-16 h-16 mx-auto text-slate-600 mb-4" />
            <p className="text-slate-400">Aucune ressource ajoutee !</p>
            <p className="text-slate-500 text-sm mt-1">
              Cliquez sur "Ajouter une ressource" pour commencer a suivre vos materiaux.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {currentCharacter.resources.map((resource) => {
              const effectiveOwned = getEffectiveOwned(resource, allocation);
              const isComplete = effectiveOwned >= resource.needed;
              const resourceProgress = resource.needed > 0
                ? Math.round((Math.min(effectiveOwned, resource.needed) / resource.needed) * 100)
                : 0;
              const remainingToFarm = getRemainingToFarm(resource, currentGame, allocation);

              const resourceImage = resource.imageUrl ? (
                <img
                  src={resource.imageUrl}
                  alt={resource.name}
                  className="w-10 h-10 object-contain rounded"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              ) : null;

              return (
                <div
                  key={resource.id}
                  className={`bg-slate-800 rounded-xl border border-slate-700 p-4 transition-all group ${
                    isComplete ? 'opacity-60' : ''
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {resourceImage || <span className="text-2xl">{resource.icon}</span>}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`font-medium text-slate-100 ${isComplete ? 'line-through' : ''}`}>
                          {resource.name}
                        </span>
                        <span className="text-xs text-slate-500 px-1.5 py-0.5 bg-slate-700 rounded">
                          {resource.type}
                        </span>
                      </div>

                      {/* Progress bar */}
                      <div className="mt-2 mb-2">
                        <ProgressBar percentage={resourceProgress} color={currentGame.color} />
                      </div>

                      <div className="flex items-center gap-3 text-sm">
                        <div className="flex items-center gap-1">
                          <span className="text-slate-400">Total:</span>
                          {inlineEditResourceId === resource.id ? (
                            <input
                              type="number"
                              value={inlineEditValue}
                              onChange={(e) => setInlineEditValue(e.target.value)}
                              onBlur={finishInlineEdit}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') finishInlineEdit();
                                if (e.key === 'Escape') {
                                  setInlineEditResourceId(null);
                                }
                              }}
                              className="w-14 bg-slate-700 border border-slate-600 rounded px-1.5 py-0.5 text-slate-200 text-sm focus:outline-none focus:border-blue-500"
                              autoFocus
                            />
                          ) : (
                            <span
                              className="text-slate-200 cursor-pointer hover:text-blue-400 transition-colors"
                              onClick={() => startInlineEdit(currentGame.id, currentCharacter.id, resource.id, resource.owned)}
                            >
                              {effectiveOwned}
                            </span>
                          )}
                          <span className="text-slate-400">/ {resource.needed}</span>
                        </div>
                        {effectiveOwned !== resource.owned && (
                          <span className="text-xs text-slate-500">
                            (dont {effectiveOwned - resource.owned} en stock)
                          </span>
                        )}
                      </div>

                      {remainingToFarm > 0 && (
                        <p className="text-xs text-yellow-400 mt-1 flex items-center gap-1">
                          <span>Reste {remainingToFarm} a farmer</span>
                          {resource.dropRate > 0 && resource.energyCost > 0 && (
                            <span className="text-blue-400">
                              ({Math.ceil(remainingToFarm / (resource.dropRate / 100))} runs / {Math.ceil(remainingToFarm / (resource.dropRate / 100)) * resource.energyCost} energie)
                            </span>
                          )}
                          {resource.dropRate > 0 && resource.energyCost === 0 && (
                            <span className="text-blue-400">
                              ({Math.ceil(remainingToFarm / (resource.dropRate / 100))} runs)
                            </span>
                          )}
                        </p>
                      )}

                      <div className="flex items-center gap-2 mt-2 text-xs text-slate-500">
                        {resource.farmLocation && (
                          <span className="flex items-center gap-1">
                            <Package className="w-3 h-3" />
                            {resource.farmLocation}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {resource.daysAvailable.map((d) => dayLabels[d]).join(', ')}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      {isComplete ? (
                        <div className="flex items-center gap-1 text-green-400">
                          <Check className="w-4 h-4" />
                          <span className="text-xs">OK</span>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleUpdateResourceOwned(currentGame.id, currentCharacter.id, resource.id, resource.needed)}
                          className="px-2 py-1 bg-green-600 hover:bg-green-700 text-white text-xs rounded transition-colors"
                        >
                          Completer
                        </button>
                      )}
                      <div className="flex gap-1">
                        <button
                          onClick={() => {
                            setEditingResource(resource);
                            setShowResourceModal(true);
                          }}
                          className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-slate-200 transition-colors"
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() =>
                            setShowDeleteConfirm({
                              type: 'resource',
                              id: resource.id,
                              name: resource.name,
                            })
                          }
                          className="p-1 hover:bg-red-500/20 rounded text-slate-400 hover:text-red-400 transition-colors"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Checklists Section */}
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
              <Check className="w-5 h-5" />
              Checklists
            </h2>
            <button
              onClick={() => {
                const title = prompt('Titre de la checklist:');
                if (title?.trim()) {
                  handleAddChecklist(currentCharacter.id, title.trim());
                }
              }}
              className="flex items-center gap-1 px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded transition-colors"
            >
              <Plus className="w-3 h-3" />
              Nouvelle checklist
            </button>
          </div>

          {currentCharacter.checklists.length === 0 ? (
            <p className="text-slate-500 text-sm text-center py-4">
              Aucune checklist. Creez-en une pour suivre vos taches !
            </p>
          ) : (
            <div className="space-y-3">
              {currentCharacter.checklists.map((checklist) => (
                <ChecklistCard
                  key={checklist.id}
                  checklist={checklist}
                  characterId={currentCharacter.id}
                  onToggleItem={handleToggleChecklistItem}
                  onUpdateItem={handleUpdateChecklistItem}
                  onDeleteItem={handleDeleteChecklistItem}
                  onAddItem={handleAddChecklistItem}
                  onDeleteChecklist={handleDeleteChecklist}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen text-slate-100">
      {/* Navigation */}
      <nav className="glass border-b border-slate-700/50 sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => {
                setCurrentView('dashboard');
                setSelectedGameId(null);
                setSelectedCharacterId(null);
              }}
              className="text-xl font-bold flex items-center gap-2 bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent hover:from-blue-300 hover:to-purple-300 transition-all"
            >
              <Gamepad2 className="w-6 h-6 text-blue-400" />
              Gacha Farm
            </button>
            <div className="flex gap-1 p-1 bg-slate-800/50 rounded-lg">
              <button
                onClick={() => {
                  setCurrentView('dashboard');
                  setSelectedGameId(null);
                  setSelectedCharacterId(null);
                }}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                  currentView === 'dashboard'
                    ? 'bg-gradient-to-r from-blue-600 to-blue-500 text-white shadow-md'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Tableau de bord
              </button>
              <button
                onClick={() => {
                  setCurrentView('games');
                  setSelectedGameId(null);
                  setSelectedCharacterId(null);
                }}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                  currentView === 'games' || currentView === 'game-detail' || currentView === 'character-detail' || currentView === 'inventory'
                    ? 'bg-gradient-to-r from-blue-600 to-blue-500 text-white shadow-md'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Jeux
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleExport}
              className="flex items-center gap-2 px-3 py-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-700/50 rounded-lg transition-colors"
            >
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">Exporter</span>
            </button>
            <button
              onClick={() => setShowImportModal(true)}
              className="flex items-center gap-2 px-3 py-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-700/50 rounded-lg transition-colors"
            >
              <Upload className="w-4 h-4" />
              <span className="hidden sm:inline">Importer</span>
            </button>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 py-6">
        {currentView === 'dashboard' && renderDashboard()}
        {currentView === 'games' && renderGamesList()}
        {currentView === 'game-detail' && renderGameDetail()}
        {currentView === 'character-detail' && renderCharacterDetail()}
        {currentView === 'inventory' && renderInventory()}
      </main>

      {/* Game Modal */}
      <Modal
        isOpen={showGameModal}
        onClose={() => {
          setShowGameModal(false);
          setEditingGame(null);
        }}
        title={editingGame ? 'Modifier le jeu' : 'Ajouter un jeu'}
        size="lg"
      >
        <GameForm />
      </Modal>

      {/* Character Modal */}
      <Modal
        isOpen={showCharacterModal}
        onClose={() => {
          setShowCharacterModal(false);
          setEditingCharacter(null);
        }}
        title={editingCharacter ? 'Modifier le personnage' : 'Ajouter un personnage'}
        size="lg"
      >
        <CharacterForm />
      </Modal>

      {/* Resource Modal */}
      <Modal
        isOpen={showResourceModal}
        onClose={() => {
          setShowResourceModal(false);
          setEditingResource(null);
        }}
        title={editingResource ? 'Modifier la ressource' : 'Ajouter une ressource'}
      >
        <ResourceForm />
      </Modal>

      {/* Inventory Modal */}
      <Modal
        isOpen={showInventoryModal}
        onClose={() => {
          setShowInventoryModal(false);
          setEditingInventoryItem(null);
          setPendingInventoryType(null);
        }}
        title={editingInventoryItem ? "Modifier l'objet" : "Ajouter un objet"}
      >
        <InventoryItemForm />
      </Modal>

      {/* Resource Types Modal */}
      <ResourceTypesModal />

      {/* Level Modal */}
      <LevelModal />

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={showDeleteConfirm !== null}
        onClose={() => setShowDeleteConfirm(null)}
        title="Confirmer la suppression"
      >
        {showDeleteConfirm && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 text-red-400">
              <AlertTriangle className="w-6 h-6" />
              <p className="text-slate-200">
                Voulez-vous vraiment supprimer <strong>"{showDeleteConfirm.name}"</strong> ?
              </p>
            </div>
            {showDeleteConfirm.type === 'game' && (
              <p className="text-sm text-slate-400 bg-slate-800 p-3 rounded-lg">
                Tous les personnages et ressources associes a ce jeu seront definitivement supprimes.
              </p>
            )}
            {showDeleteConfirm.type === 'character' && (
              <p className="text-sm text-slate-400 bg-slate-800 p-3 rounded-lg">
                Toutes les ressources associees a ce personnage seront definitivement supprimees.
              </p>
            )}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowDeleteConfirm(null)}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={() => {
                  if (showDeleteConfirm.type === 'game') {
                    handleDeleteGame(showDeleteConfirm.id);
                  } else if (showDeleteConfirm.type === 'character') {
                    handleDeleteCharacter(showDeleteConfirm.id);
                  } else if (showDeleteConfirm.type === 'resource') {
                    handleDeleteResource(showDeleteConfirm.id);
                  } else if (showDeleteConfirm.type === 'inventory') {
                    handleDeleteInventoryItem(showDeleteConfirm.id);
                  }
                }}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
              >
                Supprimer
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Import Modal */}
      <Modal isOpen={showImportModal} onClose={() => setShowImportModal(false)} title="Importer des donnees">
        <div className="space-y-4">
          <p className="text-slate-400">
            Selectionnez un fichier JSON de sauvegarde a importer. Vous pouvez choisir de remplacer toutes les donnees ou de fusionner avec les jeux existants.
          </p>
          <input
            type="file"
            accept=".json"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                const reader = new FileReader();
                reader.onload = (ev) => {
                  try {
                    const content = ev.target?.result as string;
                    const imported = JSON.parse(content);
                    if (!imported.games || !Array.isArray(imported.games)) {
                      showToast('Structure de fichier invalide. Tableau "games" manquant.', 'error');
                      return;
                    }
                    handleImport(file, false);
                  } catch (err) {
                    showToast('Fichier JSON invalide.', 'error');
                  }
                };
                reader.readAsText(file);
              }
            }}
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500"
          />
          <div className="flex gap-2">
            <button
              onClick={() => setShowImportModal(false)}
              className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg transition-colors"
            >
              Annuler
            </button>
          </div>
          {data.games.length > 0 && (
            <div className="flex gap-2">
              <button
                onClick={() => {
                  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
                  const file = input?.files?.[0];
                  if (file) handleImport(file, false);
                }}
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
              >
                Fusionner (Ajouter)
              </button>
              <button
                onClick={() => {
                  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
                  const file = input?.files?.[0];
                  if (file) handleImport(file, true);
                }}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
              >
                Tout remplacer
              </button>
            </div>
          )}
        </div>
      </Modal>

      {/* Farm All Confirmation */}
      <Modal
        isOpen={showFarmAllConfirm}
        onClose={() => setShowFarmAllConfirm(false)}
        title="Marquer tout comme farme"
      >
        <div className="space-y-4">
          <p className="text-slate-200">
            Cela va mettre toutes les ressources du jour a leur quantite ciblee. Etes-vous sur d'avoir fini tout le farming du jour ?
          </p>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setShowFarmAllConfirm(false)}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg transition-colors"
            >
              Annuler
            </button>
            <button
              onClick={handleFarmAllToday}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
            >
              Confirmer
            </button>
          </div>
        </div>
      </Modal>

      {/* Toasts */}
      {toasts.map((toast) => (
        <ToastNotification key={toast.id} toast={toast} onDismiss={() => dismissToast(toast.id)} />
      ))}
    </div>
  );
}

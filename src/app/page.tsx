'use client';

import { useState, memo, useEffect } from 'react';
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, useDroppable, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, rectSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { PlusIcon, TrashIcon, VideoCameraIcon } from '@heroicons/react/24/outline';
import { useRouter } from 'next/navigation';

interface Item {
  id: string;
  name: string;
  image?: string;
}

interface Tier {
  id: string;
  name: string;
  color: string;
  items: Item[];
}

const defaultTiers: Tier[] = [
  { id: 'god', name: '夯', color: 'bg-red-300', items: [] },
  { id: 'top', name: '顶级', color: 'bg-orange-300', items: [] },
  { id: 'above', name: '人上人', color: 'bg-yellow-300', items: [] },
  { id: 'npc', name: 'NPC', color: 'bg-green-300', items: [] },
  { id: 'trash', name: '拉完了', color: 'bg-green-400', items: [] },
];

const tierColors = [
  'bg-red-300', 'bg-orange-300', 'bg-yellow-300', 'bg-green-300', 
  'bg-blue-300', 'bg-purple-300', 'bg-pink-300', 'bg-indigo-300'
];

const initialItems: Item[] = [
  { id: '1', name: '初音未来' },
  { id: '2', name: '鸣人' },
  { id: '3', name: '路飞' },
  { id: '4', name: '悟空' },
  { id: '5', name: '一拳超人' },
  { id: '6', name: '炭治郎' },
  { id: '7', name: '爱德华' },
  { id: '8', name: '利威尔' },
];

const SortableItem = memo(function SortableItem({ item, onDelete }: { item: Item; onDelete: (id: string) => void }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
        ref={setNodeRef}
        style={style}
        {...attributes}
        {...listeners}
        className="relative group bg-white border border-gray-200 rounded-lg p-2 cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow"
        suppressHydrationWarning
      >
      <div className="w-20 h-20 bg-gradient-to-br from-blue-400 to-purple-500 rounded-md mb-2 flex items-center justify-center overflow-hidden">
        {item.image ? (
          <img 
            src={item.image} 
            alt={item.name} 
            className="w-full h-full object-cover" 
            loading="lazy"
            onError={(e) => {
              console.warn(`图片加载失败: ${item.name}`, item.image);
            }}
          />
        ) : (
          <span className="text-white text-xs font-bold text-center px-1">{item.name}</span>
        )}
      </div>
      <p className="text-xs text-center truncate">{item.name}</p>
      <button
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          onDelete(item.id);
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
        }}
        onMouseDown={(e) => {
          e.stopPropagation();
        }}
        className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity z-10"
      >
        <TrashIcon className="w-3 h-3" />
      </button>
    </div>
  );
});

function UnrankedItemsArea({ 
  items, 
  onDeleteItem, 
  showAddForm, 
  setShowAddForm, 
  newItemName, 
  setNewItemName, 
  newItemImage, 
  setNewItemImage, 
  addNewItem, 
  handleImageUpload,
  isUploadingImage 
}: { 
  items: Item[]; 
  onDeleteItem: (itemId: string) => void;
  showAddForm: boolean;
  setShowAddForm: (show: boolean) => void;
  newItemName: string;
  setNewItemName: (name: string) => void;
  newItemImage: string | null;
  setNewItemImage: (image: string | null) => void;
  addNewItem: () => void;
  handleImageUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
  isUploadingImage: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: 'unranked',
  });

  return (
    <div className="mt-8">
      <h3 className="text-lg font-semibold mb-4 text-gray-700">未分类项目</h3>
      <SortableContext items={items.map(item => item.id)} strategy={rectSortingStrategy}>
        <div 
          ref={setNodeRef}
          className={`min-h-[120px] border-2 border-dashed rounded-lg p-4 transition-colors ${
            isOver ? 'bg-blue-50 border-blue-300' : 'bg-white border-gray-300'
          }`}
        >
          <div className="flex flex-wrap gap-3">
            {items.map((item) => (
              <SortableItem key={item.id} item={item} onDelete={onDeleteItem} />
            ))}
            
            {/* Add new item button */}
            {!showAddForm ? (
              <div className="relative group bg-white border-2 border-dashed border-gray-300 rounded-lg p-2 cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-all w-24">
                <button
                  onClick={() => setShowAddForm(true)}
                  className="w-full h-full flex flex-col items-center justify-center"
                >
                  <div className="w-20 h-20 bg-gradient-to-br from-gray-200 to-gray-300 rounded-md mb-2 flex items-center justify-center hover:from-blue-200 hover:to-blue-300 transition-all">
                    <PlusIcon className="w-8 h-8 text-gray-600 group-hover:text-blue-600" />
                  </div>
                  <p className="text-xs text-center text-gray-600 group-hover:text-blue-600">添加项目</p>
                </button>
              </div>
            ) : (
              <div className="w-full mt-4">
                <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
                  <div className="flex items-start gap-4">
                    {/* Image preview */}
                    <div className="flex-shrink-0">
                      <div className="w-20 h-20 border-2 border-dashed border-gray-300 rounded-lg flex items-center justify-center overflow-hidden bg-gray-50">
                        {newItemImage ? (
                          <img 
                            src={newItemImage} 
                            alt="预览" 
                            className="w-full h-full object-cover" 
                            loading="lazy"
                          />
                        ) : (
                          <div className="text-center">
                            <svg className="w-8 h-8 text-gray-400 mx-auto mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                            <p className="text-xs text-gray-500">图片</p>
                          </div>
                        )}
                      </div>
                    </div>
                    
                    {/* Form inputs */}
                    <div className="flex-1 space-y-3">
                      <input
                        type="text"
                        value={newItemName}
                        onChange={(e) => setNewItemName(e.target.value)}
                        placeholder="输入项目名称"
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        onKeyPress={(e) => e.key === 'Enter' && addNewItem()}
                      />
                      
                      <div className="flex items-center gap-2">
                        <label className={`flex items-center gap-2 px-3 py-2 rounded-md transition-colors cursor-pointer ${
                          isUploadingImage 
                            ? 'bg-blue-100 text-blue-700 cursor-not-allowed' 
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}>
                          {isUploadingImage ? (
                            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="m4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                          ) : (
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                            </svg>
                          )}
                          {isUploadingImage ? '上传中...' : '上传图片'}
                          <input
                            type="file"
                            accept="image/*"
                            onChange={handleImageUpload}
                            className="hidden"
                            disabled={isUploadingImage}
                          />
                        </label>
                        
                        {newItemImage && (
                          <button
                            onClick={() => setNewItemImage(null)}
                            className="px-2 py-1 text-red-600 hover:bg-red-50 rounded transition-colors"
                          >
                            清除
                          </button>
                        )}
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <button
                          onClick={addNewItem}
                          disabled={!newItemName.trim()}
                          className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center gap-1"
                        >
                          <PlusIcon className="w-4 h-4" />
                          添加
                        </button>
                        
                        <button
                          onClick={() => {
                            setShowAddForm(false);
                            setNewItemName('');
                            setNewItemImage(null);
                          }}
                          className="px-4 py-2 bg-gray-500 text-white rounded-md hover:bg-gray-600 transition-colors"
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </SortableContext>
    </div>
  );
}

function TierRow({ 
  tier, 
  onDeleteItem, 
  isEditing, 
  editingName, 
  onStartEdit, 
  onSaveEdit, 
  onCancelEdit, 
  onDeleteTier, 
  onEditingNameChange 
}: { 
  tier: Tier; 
  onDeleteItem: (itemId: string) => void;
  isEditing: boolean;
  editingName: string;
  onStartEdit: (tierId: string, currentName: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDeleteTier: (tierId: string) => void;
  onEditingNameChange: (name: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: tier.id,
  });

  return (
    <div className="flex items-stretch min-h-[120px] border border-gray-300 rounded-lg overflow-hidden group">
      <div className={`${tier.color} w-32 flex items-center justify-center relative`}>
        {isEditing ? (
          <div className="flex flex-col items-center gap-2 p-2">
            <input
              type="text"
              value={editingName}
              onChange={(e) => onEditingNameChange(e.target.value)}
              className="w-full text-center text-sm font-bold bg-white/90 border border-gray-300 rounded px-2 py-1"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  onSaveEdit();
                } else if (e.key === 'Escape') {
                  onCancelEdit();
                }
              }}
              autoFocus
            />
            <div className="flex gap-1">
              <button
                onClick={onSaveEdit}
                className="px-2 py-1 bg-green-500 text-white text-xs rounded hover:bg-green-600"
              >
                ✓
              </button>
              <button
                onClick={onCancelEdit}
                className="px-2 py-1 bg-gray-500 text-white text-xs rounded hover:bg-gray-600"
              >
                ✕
              </button>
            </div>
          </div>
        ) : (
          <>
            <h2 
              className="text-2xl font-bold text-gray-800 cursor-pointer hover:text-gray-600 transition-colors"
              onClick={() => onStartEdit(tier.id, tier.name)}
              title="点击编辑级别名称"
            >
              {tier.name}
            </h2>
            <button
              onClick={() => onDeleteTier(tier.id)}
              className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
              title="删除级别"
            >
              <TrashIcon className="w-3 h-3" />
            </button>
          </>
        )}
      </div>
      <div 
        ref={setNodeRef}
        className={`flex-1 p-4 transition-colors ${
          isOver ? 'bg-blue-100' : 'bg-gray-50'
        }`}
      >
        <SortableContext items={tier.items.map(item => item.id)} strategy={rectSortingStrategy}>
          <div className="flex flex-wrap gap-3 min-h-[80px]">
            {tier.items.map((item) => (
              <SortableItem key={item.id} item={item} onDelete={onDeleteItem} />
            ))}
          </div>
        </SortableContext>
      </div>
    </div>
  );
}

interface DragHistoryEntry {
  itemId: string;
  itemName: string;
  targetTierId: string;
  targetTierName: string;
  timestamp: number;
}

export default function Home() {
  const [tiers, setTiers] = useState<Tier[]>(defaultTiers);
  const [unrankedItems, setUnrankedItems] = useState<Item[]>(initialItems);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dragHistory, setDragHistory] = useState<DragHistoryEntry[]>([]);
  const [newItemName, setNewItemName] = useState('');
  const [newItemImage, setNewItemImage] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [editingTierId, setEditingTierId] = useState<string | null>(null);
  const [editingTierName, setEditingTierName] = useState('');
  const [title, setTitle] = useState('从夯到拉排行榜');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editingTitle, setEditingTitle] = useState('从夯到拉排行榜');

  // 从localStorage加载标题
  useEffect(() => {
    const savedTitle = localStorage.getItem('rankingTitle');
    if (savedTitle) {
      setTitle(savedTitle);
      setEditingTitle(savedTitle);
    }
  }, []);
  
  const router = useRouter();

  const startEditingTitle = () => {
    setEditingTitle(title);
    setIsEditingTitle(true);
  };

  const saveTitle = () => {
    if (editingTitle.trim()) {
      const newTitle = editingTitle.trim();
      setTitle(newTitle);
      localStorage.setItem('rankingTitle', newTitle);
    }
    setIsEditingTitle(false);
  };

  const cancelEditingTitle = () => {
    setEditingTitle(title);
    setIsEditingTitle(false);
  };

  const handleTitleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      saveTitle();
    } else if (e.key === 'Escape') {
      cancelEditingTitle();
    }
  };

  const exportToVideo = () => {
    // 准备排列数据
    const rankingData = {
      tiers: tiers, // 包含所有等级，包括空等级
      unrankedItems,
      dragHistory // 添加拖拽历史
    };
    
    // 检查是否有已分类的项目
    const hasRankedItems = rankingData.tiers.some(tier => tier.items.length > 0);
    if (!hasRankedItems) {
      alert('请先对项目进行分类后再导出视频');
      return;
    }
    
    // 将数据编码并传递给视频导出页面
    const dataParam = encodeURIComponent(JSON.stringify(rankingData));
    router.push(`/video-export?data=${dataParam}`);
  };

  // 级别管理函数
  const addNewTier = () => {
    const newTier: Tier = {
      id: `tier-${Date.now()}`,
      name: '新级别',
      color: tierColors[tiers.length % tierColors.length],
      items: []
    };
    setTiers([...tiers, newTier]);
    setEditingTierId(newTier.id);
    setEditingTierName(newTier.name);
  };

  const deleteTier = (tierId: string) => {
    const tierToDelete = tiers.find(tier => tier.id === tierId);
    if (tierToDelete && tierToDelete.items.length > 0) {
      // 将该级别的所有项目移动到未分类区域
      setUnrankedItems(prev => [...prev, ...tierToDelete.items]);
    }
    setTiers(prev => prev.filter(tier => tier.id !== tierId));
  };

  const startEditingTier = (tierId: string, currentName: string) => {
    setEditingTierId(tierId);
    setEditingTierName(currentName);
  };

  const saveEditingTier = () => {
    if (editingTierId && editingTierName.trim()) {
      setTiers(prev => prev.map(tier => 
        tier.id === editingTierId 
          ? { ...tier, name: editingTierName.trim() }
          : tier
      ));
    }
    setEditingTierId(null);
    setEditingTierName('');
  };

  const cancelEditingTier = () => {
    setEditingTierId(null);
    setEditingTierName('');
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    // Find the active item
    let activeItem: Item | null = null;
    let sourceTierId: string | null = null;

    // Check unranked items
    const unrankedItem = unrankedItems.find(item => item.id === activeId);
    if (unrankedItem) {
      activeItem = unrankedItem;
      sourceTierId = 'unranked';
    }

    // Check tier items
    if (!activeItem) {
      for (const tier of tiers) {
        const tierItem = tier.items.find(item => item.id === activeId);
        if (tierItem) {
          activeItem = tierItem;
          sourceTierId = tier.id;
          break;
        }
      }
    }

    if (!activeItem) return;

    // Determine target tier
    let targetTierId: string | null = null;
    if (overId === 'unranked') {
      targetTierId = 'unranked';
    } else {
      // Check if dropping on an unranked item
      const unrankedTargetItem = unrankedItems.find(item => item.id === overId);
      if (unrankedTargetItem) {
        targetTierId = 'unranked';
      } else {
        // Check if dropping on a tier
        const targetTier = tiers.find(tier => tier.id === overId);
        if (targetTier) {
          targetTierId = targetTier.id;
        } else {
          // Check if dropping on an item in a tier
          for (const tier of tiers) {
            if (tier.items.some(item => item.id === overId)) {
              targetTierId = tier.id;
              break;
            }
          }
        }
      }
    }

    if (!targetTierId) return;

    // Handle same-tier reordering
    if (sourceTierId === targetTierId) {
      if (sourceTierId === 'unranked') {
        const oldIndex = unrankedItems.findIndex(item => item.id === activeId);
        let newIndex = unrankedItems.findIndex(item => item.id === overId);
        // If dropping on the droppable area itself, append to end
        if (newIndex === -1 && overId === 'unranked') {
          newIndex = unrankedItems.length - 1;
        }
        if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
          setUnrankedItems(prev => arrayMove(prev, oldIndex, newIndex));
        }
      } else {
        setTiers(prev => prev.map(tier => {
          if (tier.id === sourceTierId) {
            const oldIndex = tier.items.findIndex(item => item.id === activeId);
            const newIndex = tier.items.findIndex(item => item.id === overId);
            if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
              return { ...tier, items: arrayMove(tier.items, oldIndex, newIndex) };
            }
          }
          return tier;
        }));
      }
      return;
    }

    // Move item between different tiers
    // Calculate insertion index
    let insertIndex = -1;
    if (targetTierId === 'unranked') {
      insertIndex = unrankedItems.findIndex(item => item.id === overId);
      if (insertIndex === -1) insertIndex = unrankedItems.length;
    } else {
      const targetTier = tiers.find(tier => tier.id === targetTierId);
      if (targetTier) {
        insertIndex = targetTier.items.findIndex(item => item.id === overId);
        if (insertIndex === -1) insertIndex = targetTier.items.length;
      }
    }

    // Remove from source
    if (sourceTierId === 'unranked') {
      setUnrankedItems(prev => prev.filter(item => item.id !== activeId));
    } else {
      setTiers(prev => prev.map(tier => 
        tier.id === sourceTierId 
          ? { ...tier, items: tier.items.filter(item => item.id !== activeId) }
          : tier
      ));
    }

    // Insert at target position
    if (targetTierId === 'unranked') {
      setUnrankedItems(prev => {
        const newItems = [...prev];
        newItems.splice(insertIndex, 0, activeItem!);
        return newItems;
      });
    } else {
      setTiers(prev => prev.map(tier => 
        tier.id === targetTierId 
          ? { 
              ...tier, 
              items: (() => {
                const newItems = [...tier.items];
                newItems.splice(insertIndex, 0, activeItem!);
                return newItems;
              })()
            }
          : tier
      ));
      
      // 记录拖拽历史（只有当项目被拖拽到等级时才记录）
      const targetTier = tiers.find(tier => tier.id === targetTierId);
      if (targetTier) {
        const historyEntry: DragHistoryEntry = {
          itemId: activeItem.id,
          itemName: activeItem.name,
          targetTierId: targetTierId,
          targetTierName: targetTier.name,
          timestamp: Date.now()
        };
        
        setDragHistory(prev => {
          // 移除该项目的之前记录，只保留最新的
          const filteredHistory = prev.filter(entry => entry.itemId !== activeItem.id);
          return [...filteredHistory, historyEntry];
        });
      }
    }
  };

  const addNewItem = () => {
    if (!newItemName.trim()) return;
    
    const newItem: Item = {
      id: Date.now().toString(),
      name: newItemName.trim(),
      image: newItemImage || undefined,
    };
    
    setUnrankedItems(prev => [...prev, newItem]);
    setNewItemName('');
    setNewItemImage(null);
    setShowAddForm(false);
  };

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setIsUploadingImage(true);
      const reader = new FileReader();
      reader.onload = async (e) => {
        const base64Data = e.target?.result as string;
        
        try {
          console.log('开始上传图片到服务器...');
          // 立即上传图片到服务器
          const response = await fetch('/api/upload-image', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              imageData: base64Data,
              fileName: file.name
            })
          });
          
          if (!response.ok) {
            throw new Error('图片上传失败');
          }
          
          const result = await response.json();
          if (!result.success) {
            throw new Error(result.error || '图片上传失败');
          }
          
          // 使用服务器返回的URL而不是base64数据
          setNewItemImage(result.imageUrl);
          console.log('图片上传成功:', result.imageUrl);
          
        } catch (error) {
          console.error('图片上传失败:', error);
          alert('图片上传失败，请重试');
          // 如果上传失败，仍然使用base64作为备用
          setNewItemImage(base64Data);
        } finally {
          setIsUploadingImage(false);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const deleteItem = (itemId: string) => {
    setUnrankedItems(prev => prev.filter(item => item.id !== itemId));
    setTiers(prev => prev.map(tier => ({
      ...tier,
      items: tier.items.filter(item => item.id !== itemId)
    })));
  };

  const activeItem = activeId ? 
    unrankedItems.find(item => item.id === activeId) ||
    tiers.flatMap(tier => tier.items).find(item => item.id === activeId)
    : null;

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          {isEditingTitle ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={editingTitle}
                onChange={(e) => setEditingTitle(e.target.value)}
                onKeyDown={handleTitleKeyPress}
                className="text-3xl font-bold text-gray-900 bg-white border border-gray-300 rounded px-3 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus
              />
              <button
                onClick={saveTitle}
                className="px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600"
              >
                ✓
              </button>
              <button
                onClick={cancelEditingTitle}
                className="px-3 py-1 bg-gray-500 text-white rounded hover:bg-gray-600"
              >
                ✕
              </button>
            </div>
          ) : (
            <h1 
              className="text-3xl font-bold text-gray-900 cursor-pointer hover:text-gray-600 transition-colors"
              onClick={startEditingTitle}
              title="点击编辑标题"
            >
              {title}
            </h1>
          )}
          <div className="flex items-center gap-4">
            <button
              onClick={exportToVideo}
              className="px-6 py-3 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors flex items-center space-x-2 shadow-lg"
            >
              <VideoCameraIcon className="w-5 h-5" />
              <span>导出视频</span>
            </button>
            <button
              onClick={addNewTier}
              className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors flex items-center gap-2"
            >
              <PlusIcon className="w-5 h-5" />
              添加新级别
            </button>
          </div>
        </div>

        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
           <div className="space-y-4">
             {tiers.map((tier) => (
               <TierRow 
                 key={tier.id} 
                 tier={tier} 
                 onDeleteItem={deleteItem}
                 isEditing={editingTierId === tier.id}
                 editingName={editingTierName}
                 onStartEdit={startEditingTier}
                 onSaveEdit={saveEditingTier}
                 onCancelEdit={cancelEditingTier}
                 onDeleteTier={deleteTier}
                 onEditingNameChange={setEditingTierName}
               />
             ))}
           </div>

          {/* Unranked Items */}
          <UnrankedItemsArea 
            items={unrankedItems} 
            onDeleteItem={deleteItem}
            showAddForm={showAddForm}
            setShowAddForm={setShowAddForm}
            newItemName={newItemName}
            setNewItemName={setNewItemName}
            newItemImage={newItemImage}
            setNewItemImage={setNewItemImage}
            addNewItem={addNewItem}
            handleImageUpload={handleImageUpload}
            isUploadingImage={isUploadingImage}
          />

          <DragOverlay>
            {activeItem ? (
              <div className="bg-white border border-gray-200 rounded-lg p-2 shadow-lg">
                <div className="w-20 h-20 bg-gradient-to-br from-blue-400 to-purple-500 rounded-md mb-2 flex items-center justify-center overflow-hidden">
                   {activeItem.image ? (
                     <img 
                       src={activeItem.image} 
                       alt={activeItem.name} 
                       className="w-full h-full object-cover" 
                       loading="lazy"
                     />
                   ) : (
                     <span className="text-white text-xs font-bold text-center px-1">{activeItem.name}</span>
                   )}
                 </div>
                <p className="text-xs text-center truncate">{activeItem.name}</p>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>
    </div>
  );
}

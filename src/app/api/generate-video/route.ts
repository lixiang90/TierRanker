import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { createCanvas, loadImage, Canvas, CanvasRenderingContext2D, Image, registerFont } from 'canvas';
import { getTempImagePath, getTempBaseDir } from '@/lib/temp-dir';
import ffmpegPath from 'ffmpeg-static';
import ffprobe from '@ffprobe-installer/ffprobe';

const execAsync = promisify(exec);
const FFMPEG_PATH: string = (ffmpegPath as unknown as string) || 'ffmpeg';
const FFPROBE_PATH: string = ((ffprobe as unknown as { path?: string })?.path ?? 'ffprobe');

// 图片缓存，避免重复加载相同图片
const imageCache = new Map<string, Image>();

// 带缓存的图片加载函数（支持 base64、临时文件、本地/远程URL）
async function loadImageWithCache(imageSource: string): Promise<Image> {
  // 检查缓存
  if (imageCache.has(imageSource)) {
    const cachedImage = imageCache.get(imageSource);
    if (cachedImage) {
      return cachedImage;
    }
  }

  let img: Image;
  try {
    if (imageSource.startsWith('data:')) {
      // 处理 data URI（base64）
      const base64Data = imageSource.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
      const imageBuffer = Buffer.from(base64Data, 'base64');
      img = await loadImage(imageBuffer);
    } else if (imageSource.startsWith('/api/temp-image/')) {
      // 直接读取后端保存的临时图片文件（兼容 Vercel 的 /tmp）
      const filename = path.basename(imageSource);
      const filePath = getTempImagePath(filename);
      const imageBuffer = await fs.promises.readFile(filePath);
      img = await loadImage(imageBuffer);
    } else if (imageSource.startsWith('http://') || imageSource.startsWith('https://')) {
      // 远程或本地完整URL
      img = await loadImage(imageSource);
    } else {
      // 尝试按不带前缀的base64或文件路径处理
      if (/^[A-Za-z0-9+/=]+$/.test(imageSource)) {
        const imageBuffer = Buffer.from(imageSource, 'base64');
        img = await loadImage(imageBuffer);
      } else if (fs.existsSync(imageSource)) {
        const imageBuffer = await fs.promises.readFile(imageSource);
        img = await loadImage(imageBuffer);
      } else {
        throw new Error(`Unsupported image source: ${imageSource}`);
      }
    }

    // 存入缓存
    imageCache.set(imageSource, img);
    return img;
  } catch (error) {
    console.error('Error loading image:', error);
    throw error;
  }
}

interface DragHistoryEntry {
  itemId: string;
  itemName: string;
  targetTierId: string;
  targetTierName: string;
  timestamp: number;
}

interface RankingData {
  tiers: Array<{
    id: string;
    name: string;
    color: string;
    items: Array<{
      id: string;
      name: string;
      image?: string;
    }>;
  }>;
  unrankedItems: Array<{
    id: string;
    name: string;
    image?: string;
  }>;
  dragHistory?: DragHistoryEntry[];
}

interface AudioSection {
  id: string;
  type: 'intro' | 'item' | 'conclusion';
  text: string;
  audioBlob?: Blob | string;
  duration: number;
  isTTS?: boolean;
}

interface RankingItem {
  id: string;
  name: string;
  image?: string;
}

interface RankingTier {
  id: string;
  name: string;
  color: string;
  items: RankingItem[];
}

interface PlacedItem {
  item: RankingItem & { tierName: string };
  originalIndex: number;
}

// 配置请求体大小限制
export const maxDuration = 300; // 15分钟超时（需与 Vercel 计划支持相符）
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    // 预先注册默认字体，避免 Fontconfig 错误
    await ensureDefaultFontRegistered();
    // 增加请求体大小限制
    const contentLength = request.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > 50 * 1024 * 1024) { // 50MB限制
      return NextResponse.json(
        { error: '请求体过大，请减少图片数量或压缩图片大小' },
        { status: 413 }
      );
    }

    const { rankingData, audioSections } = await request.json() as {
      rankingData: RankingData;
      audioSections: AudioSection[];
    };

    // 创建临时目录（Vercel 使用 /tmp，本地使用项目 temp）
    const tempBase = getTempBaseDir();
    const tempDir = path.join(tempBase, `video_${Date.now()}`);
    await fs.promises.mkdir(tempDir, { recursive: true });

    // 先处理音频，获取精确时长，随后按该时长生成帧，避免音画不同步
    const { finalAudioPath: audioPath, sectionDurations } = await processAudio(audioSections, tempDir);
    
    // 基于精确音频时长生成视频帧
    const frameCount = await generateFrames(rankingData, audioSections, tempDir, sectionDurations);
    
    // 使用ffmpeg生成视频
    const videoPath = await generateVideoWithFFmpeg(tempDir, frameCount, audioPath);
    
    // 读取生成的视频文件
    const videoBuffer = await fs.promises.readFile(videoPath);
    
    // 清理临时文件
    await cleanupTempFiles(tempDir);
    
    // 清理图片缓存
    imageCache.clear();
    
    return new NextResponse(new Uint8Array(videoBuffer), {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Disposition': 'attachment; filename="tier-ranking-video.mp4"',
      },
    });
  } catch (error) {
    console.error('视频生成错误:', error);
    
    // 清理图片缓存
    imageCache.clear();
    
    return NextResponse.json(
      { error: '视频生成失败' },
      { status: 500 }
    );
  }
}

async function generateFrames(
  rankingData: RankingData,
  audioSections: AudioSection[],
  tempDir: string,
  sectionDurations?: number[]
): Promise<number> {
  const canvas = createCanvas(1920, 1080);
  const ctx = canvas.getContext('2d');
  
  let frameIndex = 0;
  const fps = 30;
  
  // 基于已转码音频的精确时长（来自 processAudio）构建时长数组
  const audioSectionsWithDuration = audioSections.map((section, index) => {
    let duration = sectionDurations?.[index];
    if (!duration || duration <= 0) {
      if (section.duration && section.duration > 0) {
        duration = section.duration;
      } else if (section.isTTS && section.text) {
        // 中文语速估算：约每秒4字，至少2秒
        duration = Math.max(2, section.text.length / 4);
      } else {
        duration = 3.84; // 保底时长
      }
      console.warn(`音频段落${index}缺少精确时长，使用估算值: ${duration.toFixed(2)}秒`);
    } else {
      console.log(`音频段落${index} (${section.type}) 精确时长: ${duration.toFixed(2)}秒`);
    }
    return { ...section, duration };
  });
  
  // 阶段1: 显示空白等级结构
  const introSection = audioSectionsWithDuration.find(s => s.type === 'intro');
  const introDuration = introSection?.duration || 3;
  const introFrames = Math.floor(introDuration * fps);
  
  for (let i = 0; i < introFrames; i++) {
    drawBlankTierStructure(ctx, rankingData.tiers);
    await saveFrame(canvas, tempDir, frameIndex++);
  }
  
  // 阶段2: 按拖拽历史顺序逐项移动动画
  let allItems: (RankingItem & { tierName: string; tierColor?: string })[] = [];
  
  if (rankingData.dragHistory && rankingData.dragHistory.length > 0) {
    // 按拖拽历史顺序排列项目
    const sortedHistory = [...rankingData.dragHistory].sort((a, b) => a.timestamp - b.timestamp);
    
    allItems = sortedHistory.map(historyEntry => {
      const tier = rankingData.tiers.find(t => t.id === historyEntry.targetTierId);
      const item = tier?.items.find(i => i.id === historyEntry.itemId);
      
      if (item && tier) {
        return { ...item, tierName: tier.name, tierColor: tier.color };
      }
      return null;
    }).filter(item => item !== null);
  } else {
    // 如果没有拖拽历史，回退到原来的按等级顺序
    allItems = [
      ...rankingData.tiers.flatMap(tier => 
        tier.items.map(item => ({ ...item, tierName: tier.name, tierColor: tier.color }))
      ),
      ...rankingData.unrankedItems.map(item => ({ ...item, tierName: '未分类', tierColor: '#gray' }))
    ];
  }
  
  // 为每个项目生成对应音频段落时长的动画
  const itemSections = audioSectionsWithDuration.filter(s => s.type === 'item');
  
  for (let itemIndex = 0; itemIndex < allItems.length; itemIndex++) {
    const item = allItems[itemIndex];
    const correspondingSection = itemSections[itemIndex];
    const itemDuration = correspondingSection?.duration || 2; // 如果找不到对应音频段落，默认2秒
    const itemFrames = Math.floor(itemDuration * fps);
    
    // 判断是否需要中心舞台动画（语音时间较长）
    const needsCenterStage = itemDuration > 4; // 超过4秒的语音使用中心舞台动画
    
    // 计算目标位置信息
    const tier = rankingData.tiers.find(t => t.name === item.tierName);
    const targetItemIndex = tier?.items.findIndex((i: RankingItem) => i.id === item.id) || 0;
    
    // 检查是否需要位置替换动画
    // 当新项目插入到等级中间位置时，后面的项目需要被挤压
    const needsPositionReplacement = tier && tier.items.length > 1 && targetItemIndex < tier.items.length - 1;
    

    
    for (let frame = 0; frame < itemFrames; frame++) {
      const progress = frame / itemFrames;
      
      // 绘制背景和等级结构
      drawBlankTierStructure(ctx, rankingData.tiers);
      
      // 绘制已放置的项目（考虑位置替换动画）
      // 按等级分组已放置的项目
      const placedItemsByTier = new Map<string, PlacedItem[]>();
      for (let i = 0; i < itemIndex; i++) {
        const placedItem = allItems[i];
        if (!placedItemsByTier.has(placedItem.tierName)) {
          placedItemsByTier.set(placedItem.tierName, []);
        }
        placedItemsByTier.get(placedItem.tierName)!.push({ item: placedItem, originalIndex: i });
      }
      
      // 为每个等级绘制已放置的项目
       for (const [tierName, tierItems] of placedItemsByTier) {
         const placedTier = rankingData.tiers.find(t => t.name === tierName);
         if (placedTier) {
           const placedTierIndex = rankingData.tiers.findIndex(t => t.name === tierName);
           
           for (let indexInTier = 0; indexInTier < tierItems.length; indexInTier++) {
             const tierItem = tierItems[indexInTier];
             const placedItem = tierItem.item;
             let x, y;
             
             // 位置替换动画：如果当前项目要插入到同一等级，且已放置的项目需要向后移动
             if (tierName === item.tierName && 
                 indexInTier >= targetItemIndex && 
                 needsPositionReplacement) {
               // 计算挤压动画的偏移
               const pushProgress = Math.min(1, progress * 1.5); // 前2/3时间完成挤压
               
               const tierHeight = 120;
               const startY = 150;
               y = startY + placedTierIndex * (tierHeight + 20);
               x = 290 + (indexInTier + pushProgress) * 110;
               
               // 添加挤压动画的视觉效果
               if (pushProgress < 1) {
                 // 在挤压过程中添加轻微的抖动效果
                 const shake = Math.sin(progress * Math.PI * 8) * (1 - pushProgress) * 2;
                 x += shake;
                 y += shake;
               }
             } else {
               const tierHeight = 120;
               const startY = 150;
               y = startY + placedTierIndex * (tierHeight + 20);
               x = 290 + indexInTier * 110;
             }
             
             await drawItemInTier(ctx, placedItem, x, y + 10, 100, 100);
           }
         }
       }
      
      // 绘制当前移动的项目
      if (needsCenterStage) {
        await drawMovingItemWithCenterStage(ctx, item, progress, rankingData.tiers);
      } else {
        await drawMovingItem(ctx, item, progress, rankingData.tiers);
      }
      
      await saveFrame(canvas, tempDir, frameIndex++);
    }
  }
  
  // 阶段3: 显示最终完成状态
  const conclusionSection = audioSectionsWithDuration.find(s => s.type === 'conclusion');
  const conclusionDuration = conclusionSection?.duration || 3;
  const conclusionFrames = Math.floor(conclusionDuration * fps);
  
  for (let i = 0; i < conclusionFrames; i++) {
    await drawCompleteTierTable(ctx, rankingData);
    await saveFrame(canvas, tempDir, frameIndex++);
  }
  
  return frameIndex;
}

// Tailwind CSS颜色映射
const colorMap: { [key: string]: string } = {
  'bg-red-300': '#fca5a5',
  'bg-orange-300': '#fdba74',
  'bg-yellow-300': '#fde047',
  'bg-green-300': '#86efac',
  'bg-green-400': '#4ade80',
  'bg-blue-300': '#93c5fd',
  'bg-purple-300': '#c4b5fd',
  'bg-pink-300': '#f9a8d4',
  'bg-indigo-300': '#a5b4fc'
};

function drawBlankTierStructure(ctx: CanvasRenderingContext2D, tiers: RankingTier[]) {
  // 清空画布 - 使用浅灰色背景
  ctx.fillStyle = '#f3f4f6';
  ctx.fillRect(0, 0, 1920, 1080);
  
  // 绘制标题
  ctx.fillStyle = '#1f2937';
  ctx.font = 'bold 48px DefaultSans';
  ctx.textAlign = 'center';
  ctx.fillText('从夯到拉排行榜', 960, 80);
  
  // 绘制等级行
  const tierHeight = 120;
  const startY = 150;
  
  tiers.forEach((tier, index) => {
    const y = startY + index * (tierHeight + 20);
    
    // 绘制等级标签
    const hexColor = colorMap[tier.color] || '#9ca3af';
    ctx.fillStyle = hexColor;
    ctx.fillRect(50, y, 200, tierHeight);
    
    // 添加边框
    ctx.strokeStyle = '#d1d5db';
    ctx.lineWidth = 2;
    ctx.strokeRect(50, y, 200, tierHeight);
    
    ctx.fillStyle = '#1f2937';
    ctx.font = 'bold 32px DefaultSans';
    ctx.textAlign = 'center';
    ctx.fillText(tier.name, 150, y + tierHeight / 2 + 12);
    
    // 绘制等级内容区域
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(270, y, 1600, tierHeight);
    ctx.strokeStyle = '#d1d5db';
    ctx.lineWidth = 2;
    ctx.strokeRect(270, y, 1600, tierHeight);
  });
}



async function drawItemInTier(ctx: CanvasRenderingContext2D, item: RankingItem, x: number, y: number, width: number, height: number) {
  // 绘制项目背景
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, width, height);
  
  // 绘制项目边框
  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, width, height);
  
  if (item.image) {
    try {
      // 使用缓存加载图片
      const img = await loadImageWithCache(item.image);
      
      // 计算图片显示区域（保持宽高比）
      const padding = 5;
      const imageArea = {
        x: x + padding,
        y: y + padding,
        width: width - padding * 2,
        height: height - 30 - padding // 为文字预留30px高度
      };
      
      const imgAspect = img.width / img.height;
      const areaAspect = imageArea.width / imageArea.height;
      
      let drawWidth, drawHeight, drawX, drawY;
      
      if (imgAspect > areaAspect) {
        // 图片更宽，以宽度为准
        drawWidth = imageArea.width;
        drawHeight = imageArea.width / imgAspect;
        drawX = imageArea.x;
        drawY = imageArea.y + (imageArea.height - drawHeight) / 2;
      } else {
        // 图片更高，以高度为准
        drawHeight = imageArea.height;
        drawWidth = imageArea.height * imgAspect;
        drawX = imageArea.x + (imageArea.width - drawWidth) / 2;
        drawY = imageArea.y;
      }
      
      // 绘制圆角图片
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(drawX, drawY, drawWidth, drawHeight, 8);
      ctx.clip();
      ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
      ctx.restore();
      
      // 绘制项目名称在图片下方
      ctx.fillStyle = '#1f2937';
      ctx.font = 'bold 12px DefaultSans';
      ctx.textAlign = 'center';
      ctx.fillText(item.name, x + width / 2, y + height - 8);
      
    } catch (error) {
      console.error('Error loading image:', error);
      // 图片加载失败时使用默认样式
      drawDefaultItemStyle(ctx, item, x, y, width, height);
    }
  } else {
    // 没有图片时使用默认样式
    drawDefaultItemStyle(ctx, item, x, y, width, height);
  }
}

function drawDefaultItemStyle(ctx: CanvasRenderingContext2D, item: RankingItem, x: number, y: number, width: number, height: number) {
  // 绘制渐变背景
  const gradient = ctx.createLinearGradient(x, y, x + width, y + height);
  gradient.addColorStop(0, '#3b82f6');
  gradient.addColorStop(1, '#8b5cf6');
  ctx.fillStyle = gradient;
  ctx.fillRect(x + 5, y + 5, width - 10, height - 10);
  
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 14px DefaultSans';
  ctx.textAlign = 'center';
  ctx.fillText(item.name, x + width / 2, y + height / 2 + 5);
}

async function drawMovingItemWithCenterStage(ctx: CanvasRenderingContext2D, item: RankingItem & { tierName: string }, progress: number, tiers: RankingTier[]) {
  const tier = tiers.find(t => t.name === item.tierName);
  if (!tier) return;
  
  const tierIndex = tiers.findIndex(t => t.name === item.tierName);
  const itemIndex = tier.items.findIndex((i: RankingItem) => i.id === item.id);
  
  const tierHeight = 120;
  const tierStartY = 150;
  const targetY = tierStartY + tierIndex * (tierHeight + 20) + 10;
  const targetX = 290 + itemIndex * 110;
  
  // 中心舞台位置
  const centerX = 960;
  const centerY = 400;
  const centerSize = 150; // 放大的尺寸
  
  // 起始位置
  const startX = 960;
  const startY = 1000;
  
  let currentX, currentY, currentSize;
  
  // 三阶段动画：移动到中心 -> 中心定格 -> 移动到目标位置
  const moveToCenter = 0.2; // 前20%时间移动到中心
  const stayAtCenter = 0.6; // 中间60%时间在中心定格
  const moveToTarget = 0.2; // 后20%时间移动到目标位置
  
  if (progress <= moveToCenter) {
    // 阶段1：移动到中心并放大
    const stageProgress = progress / moveToCenter;
    currentX = startX + (centerX - startX) * stageProgress;
    currentY = startY + (centerY - startY) * stageProgress;
    currentSize = 100 + (centerSize - 100) * stageProgress;
  } else if (progress <= moveToCenter + stayAtCenter) {
    // 阶段2：在中心定格
    currentX = centerX;
    currentY = centerY;
    currentSize = centerSize;
  } else {
    // 阶段3：从中心移动到目标位置并缩小
    const stageProgress = (progress - moveToCenter - stayAtCenter) / moveToTarget;
    currentX = centerX + (targetX - centerX) * stageProgress;
    currentY = centerY + (targetY - centerY) * stageProgress;
    currentSize = centerSize + (100 - centerSize) * stageProgress;
  }
  
  // 绘制移动中的项目背景
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(currentX - currentSize/2, currentY - currentSize/2, currentSize, currentSize);
  
  // 绘制移动中的项目边框（高亮显示）
  ctx.strokeStyle = '#fbbf24';
  ctx.lineWidth = 4;
  ctx.strokeRect(currentX - currentSize/2, currentY - currentSize/2, currentSize, currentSize);
  
  await drawMovingItemContent(ctx, item, currentX - currentSize/2, currentY - currentSize/2, currentSize);
}

async function drawMovingItem(ctx: CanvasRenderingContext2D, item: RankingItem & { tierName: string }, progress: number, tiers: RankingTier[]) {
  // 简化的移动动画，从屏幕底部移动到目标位置
  const startX = 960;
  const startY = 1000;
  
  const tier = tiers.find(t => t.name === item.tierName);
  if (!tier) return;
  
  const tierIndex = tiers.findIndex(t => t.name === item.tierName);
  const itemIndex = tier.items.findIndex((i: RankingItem) => i.id === item.id);
  
  const tierHeight = 120;
  const tierStartY = 150;
  const targetY = tierStartY + tierIndex * (tierHeight + 20) + 10;
  const targetX = 290 + itemIndex * 110;
  
  const currentX = startX + (targetX - startX) * progress;
  const currentY = startY + (targetY - startY) * progress;
  
  // 绘制移动中的项目背景
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(currentX, currentY, 100, 100);
  
  // 绘制移动中的项目边框（高亮显示）
  ctx.strokeStyle = '#fbbf24';
  ctx.lineWidth = 3;
  ctx.strokeRect(currentX, currentY, 100, 100);
  
  await drawMovingItemContent(ctx, item, currentX, currentY, 100);
}

async function drawMovingItemContent(ctx: CanvasRenderingContext2D, item: RankingItem, x: number, y: number, size: number) {
  if (item.image) {
    try {
      // 使用缓存加载图片
      const img = await loadImageWithCache(item.image);
      
      // 计算图片显示区域（保持宽高比）
      const padding = Math.max(8, size * 0.08); // 根据尺寸调整padding
      const textHeight = Math.max(30, size * 0.2); // 根据尺寸调整文字区域高度
      const imageArea = {
        x: x + padding,
        y: y + padding,
        width: size - padding * 2,
        height: size - textHeight - padding
      };
      
      const imgAspect = img.width / img.height;
      const areaAspect = imageArea.width / imageArea.height;
      
      let drawWidth, drawHeight, drawX, drawY;
      
      if (imgAspect > areaAspect) {
        // 图片更宽，以宽度为准
        drawWidth = imageArea.width;
        drawHeight = imageArea.width / imgAspect;
        drawX = imageArea.x;
        drawY = imageArea.y + (imageArea.height - drawHeight) / 2;
      } else {
        // 图片更高，以高度为准
        drawHeight = imageArea.height;
        drawWidth = imageArea.height * imgAspect;
        drawX = imageArea.x + (imageArea.width - drawWidth) / 2;
        drawY = imageArea.y;
      }
      
      // 绘制圆角图片
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(drawX, drawY, drawWidth, drawHeight, Math.max(4, size * 0.05));
      ctx.clip();
      ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
      ctx.restore();
      
      // 绘制项目名称在图片下方
      ctx.fillStyle = '#1f2937';
      const fontSize = Math.max(12, size * 0.12);
      ctx.font = `bold ${fontSize}px DefaultSans`;
      ctx.textAlign = 'center';
      ctx.fillText(item.name, x + size / 2, y + size - padding);
      
    } catch (error) {
      console.error('Error loading image in moving item:', error);
      // 图片加载失败时使用默认样式
      drawMovingItemDefaultStyle(ctx, item, x, y, size);
    }
  } else {
    // 没有图片时使用默认样式
    drawMovingItemDefaultStyle(ctx, item, x, y, size);
  }
}

function drawMovingItemDefaultStyle(ctx: CanvasRenderingContext2D, item: RankingItem, x: number, y: number, size: number = 100) {
  // 绘制移动中的项目渐变背景
  const padding = Math.max(5, size * 0.05);
  const gradient = ctx.createLinearGradient(x, y, x + size, y + size);
  gradient.addColorStop(0, '#f59e0b');
  gradient.addColorStop(1, '#d97706');
  ctx.fillStyle = gradient;
  ctx.fillRect(x + padding, y + padding, size - padding * 2, size - padding * 2);
  
  ctx.fillStyle = '#ffffff';
  const fontSize = Math.max(14, size * 0.14);
  ctx.font = `bold ${fontSize}px DefaultSans`;
  ctx.textAlign = 'center';
  ctx.fillText(item.name, x + size / 2, y + size / 2 + fontSize / 3);
}

async function drawCompleteTierTable(ctx: CanvasRenderingContext2D, rankingData: RankingData) {
  drawBlankTierStructure(ctx, rankingData.tiers);
  
  // 绘制所有项目在其最终位置
  for (const [tierIndex, tier] of rankingData.tiers.entries()) {
    for (const [itemIndex, item] of tier.items.entries()) {
      const tierHeight = 120;
      const startY = 150;
      const y = startY + tierIndex * (tierHeight + 20);
      const x = 290 + itemIndex * 110;
      
      await drawItemInTier(ctx, item, x, y + 10, 100, 100);
    }
  }
}

async function saveFrame(canvas: Canvas, tempDir: string, frameIndex: number) {
  const buffer = canvas.toBuffer('image/png');
  const framePath = path.join(tempDir, `frame_${frameIndex.toString().padStart(6, '0')}.png`);
  await fs.promises.writeFile(framePath, buffer);
}

async function processAudio(audioSections: AudioSection[], tempDir: string): Promise<{ finalAudioPath: string; sectionDurations: number[] }> {
  const audioFiles: string[] = [];
  const sectionDurations: number[] = [];

  // 辅助：解析 data URI 获取音频扩展名，并做格式归一化
  const getAudioExtFromDataUri = (dataUri: string): string | null => {
    const match = /^data:audio\/([a-zA-Z0-9\-]+);base64,/.exec(dataUri);
    const raw = match?.[1]?.toLowerCase() || null;
    if (!raw) return null;
    // 常见类型归一化：audio/mpeg -> mp3, audio/x-wav -> wav, audio/webm -> webm
    const map: Record<string, string> = {
      mpeg: 'mp3',
      mp3: 'mp3',
      wav: 'wav',
      'x-wav': 'wav',
      webm: 'webm',
      ogg: 'ogg',
      m4a: 'm4a',
      'x-m4a': 'm4a',
      aac: 'aac'
    };
    return map[raw] || raw;
  };

  // 使用 ffprobe 获取音频时长（秒）
  const probeDuration = async (filePath: string): Promise<number | null> => {
    try {
      const { stdout } = await execAsync(`${FFPROBE_PATH} -v quiet -show_entries format=duration -of csv=p=0 "${filePath}"`);
      const value = parseFloat(stdout.trim());
      return isNaN(value) ? null : value;
    } catch (e) {
      return null;
    }
  };
  
  // 处理每个音频段落
  for (let i = 0; i < audioSections.length; i++) {
    const section = audioSections[i];
    const sectionPath = path.join(tempDir, `audio_section_${i}.wav`);
    
    if (section.audioBlob && typeof section.audioBlob === 'string') {
      // 处理 base64 编码的音频数据，按真实格式保存后转码为 wav
      const base64Data = section.audioBlob.split(',')[1];
      const audioBuffer = Buffer.from(base64Data, 'base64');
      const ext = getAudioExtFromDataUri(section.audioBlob) || 'mp3';
      const tempAudioPath = path.join(tempDir, `temp_audio_${i}.${ext}`);
      
      await fs.promises.writeFile(tempAudioPath, audioBuffer);
      await execAsync(`${FFMPEG_PATH} -i "${tempAudioPath}" -ar 44100 -ac 2 "${sectionPath}"`);
      await fs.promises.unlink(tempAudioPath).catch(() => {});

      // 使用 ffprobe 获取转码后的精确时长
      const d = await probeDuration(sectionPath);
      sectionDurations[i] = d && d > 0 ? d : (section.duration || 3);
    } else {
      // 如果没有音频数据，生成对应时长的静音
      let duration = section.duration || 3;
      
      // 如果是TTS段落，根据文本长度估算合理的时长
      if (section.isTTS && section.text) {
        // 中文语音大约每分钟200-250字，这里按每秒4字计算
        const estimatedDuration = Math.max(2, section.text.length / 4);
        duration = estimatedDuration;
        console.log(`TTS段落 "${section.text.substring(0, 20)}..." 估算时长: ${duration}秒`);
      }
      
      await execAsync(`${FFMPEG_PATH} -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 -t ${duration} "${sectionPath}"`);
      sectionDurations[i] = duration;
    }
    
    audioFiles.push(sectionPath);
  }
  
  // 如果只有一个音频文件，直接返回
  if (audioFiles.length === 1) {
    return { finalAudioPath: audioFiles[0], sectionDurations };
  }
  
  // 合并所有音频文件
  const finalAudioPath = path.join(tempDir, 'final_audio.wav');
  const concatListPath = path.join(tempDir, 'audio_list.txt');
  
  // 创建ffmpeg concat列表文件
  const concatList = audioFiles.map(file => `file '${file.replace(/\\/g, '/')}'`).join('\n');
  await fs.promises.writeFile(concatListPath, concatList);
  
  // 使用ffmpeg合并音频
  await execAsync(`${FFMPEG_PATH} -f concat -safe 0 -i "${concatListPath}" -c copy "${finalAudioPath}"`);
  
  return { finalAudioPath, sectionDurations };
}

async function generateVideoWithFFmpeg(
  tempDir: string,
  frameCount: number,
  audioPath: string
): Promise<string> {
  const videoPath = path.join(tempDir, 'output.mp4');
  const framesPattern = path.join(tempDir, 'frame_%06d.png');
  
  // 使用ffmpeg合成视频
  const command = `${FFMPEG_PATH} -framerate 30 -i "${framesPattern}" -i "${audioPath}" -c:v libx264 -c:a aac -pix_fmt yuv420p -shortest "${videoPath}"`;
  
  await execAsync(command);
  
  return videoPath;
}

async function cleanupTempFiles(tempDir: string) {
  try {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  } catch (error) {
    console.error('清理临时文件失败:', error);
  }
}
// 在无 Fontconfig 环境（如 Vercel）注册一个可用的默认字体，避免字体匹配报错
let fontInitialized = false;
async function ensureDefaultFontRegistered() {
  if (fontInitialized) return;
  try {
    // 允许通过环境变量指定字体路径（例如持久化到项目中或 Blob 存储）
    const envFontPath = process.env.CANVAS_FONT_PATH;
    let fontPath = envFontPath && envFontPath.trim() ? envFontPath : '';

    if (!fontPath) {
      // 首选：项目内置中文字体（支持 CJK），避免方框显示
      const fontsDir = path.join(process.cwd(), 'public', 'fonts');
      const bundledTtf = path.join(fontsDir, 'NotoSansSC-Regular.ttf');
      const bundledOtf = path.join(fontsDir, 'NotoSansSC-Regular.otf');
      try {
        await fs.promises.access(bundledTtf);
        fontPath = bundledTtf;
      } catch {
        try {
          await fs.promises.access(bundledOtf);
          fontPath = bundledOtf;
        } catch {
          // 回退：下载 NotoSansSC 到可写临时目录（OTF 格式）
          const tempBase = getTempBaseDir();
          fontPath = path.join(tempBase, 'NotoSansSC-Regular.otf');
          try {
            await fs.promises.access(fontPath).catch(async () => {
              const url = 'https://github.com/googlefonts/noto-cjk/raw/main/Sans/OTF/SimplifiedChinese/NotoSansSC-Regular.otf';
              const res = await fetch(url);
              if (!res.ok) throw new Error(`下载字体失败: ${res.status}`);
              const arrayBuffer = await res.arrayBuffer();
              await fs.promises.writeFile(fontPath, Buffer.from(arrayBuffer));
            });
          } catch (e) {
            console.warn('下载或写入中文字体失败，将继续使用系统回退字体:', e);
          }
        }
      }
    }

    // 如果有可用的字体文件，注册为 DefaultSans
    if (fontPath) {
      try {
        registerFont(fontPath, { family: 'DefaultSans' });
        fontInitialized = true;
      } catch (e) {
        console.warn('注册字体失败，将继续使用系统回退字体:', e);
      }
    }
  } catch (e) {
    console.warn('初始化默认字体失败，将继续使用系统回退字体:', e);
  }
}
import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { createCanvas, loadImage } from 'canvas';

const execAsync = promisify(exec);

// 图片缓存，避免重复加载相同图片
const imageCache = new Map<string, any>();

// 带缓存的图片加载函数
async function loadImageWithCache(imageSource: string): Promise<any> {
  // 检查缓存
  if (imageCache.has(imageSource)) {
    return imageCache.get(imageSource);
  }

  let img;
  try {
    if (imageSource.startsWith('http://') || imageSource.startsWith('https://') || imageSource.startsWith('/api/')) {
      // 如果是URL，直接加载
      const fullUrl = imageSource.startsWith('/api/') ? `http://localhost:3001${imageSource}` : imageSource;
      img = await loadImage(fullUrl);
    } else {
      // 如果是base64数据，解码后加载
      const base64Data = imageSource.replace(/^data:image\/[a-z]+;base64,/, '');
      const imageBuffer = Buffer.from(base64Data, 'base64');
      img = await loadImage(imageBuffer);
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
  audioBlob?: Blob;
  duration: number;
  isTTS?: boolean;
}

// 配置请求体大小限制
export const maxDuration = 300; // 5分钟超时
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
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

    // 创建临时目录
    const tempDir = path.join(process.cwd(), 'temp', `video_${Date.now()}`);
    await fs.promises.mkdir(tempDir, { recursive: true });

    // 生成视频帧
    const frameCount = await generateFrames(rankingData, audioSections, tempDir);
    
    // 处理音频文件
    const audioPath = await processAudio(audioSections, tempDir);
    
    // 使用ffmpeg生成视频
    const videoPath = await generateVideoWithFFmpeg(tempDir, frameCount, audioPath);
    
    // 读取生成的视频文件
    const videoBuffer = await fs.promises.readFile(videoPath);
    
    // 清理临时文件
    await cleanupTempFiles(tempDir);
    
    // 清理图片缓存
    imageCache.clear();
    
    return new NextResponse(videoBuffer, {
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
  tempDir: string
): Promise<number> {
  const canvas = createCanvas(1920, 1080);
  const ctx = canvas.getContext('2d');
  
  let frameIndex = 0;
  const fps = 30;
  
  // 首先获取所有音频段落的实际时长
  const audioSectionsWithDuration = await Promise.all(
    audioSections.map(async (section, index) => {
      let duration = section.duration || 3; // 默认3秒
      
      if (section.audioBlob && typeof section.audioBlob === 'string') {
        // 如果有实际音频数据，获取其时长
        try {
          const base64Data = section.audioBlob.split(',')[1];
          const audioBuffer = Buffer.from(base64Data, 'base64');
          const tempAudioPath = path.join(tempDir, `temp_duration_${index}.webm`);
          const wavPath = path.join(tempDir, `temp_duration_${index}.wav`);
          
          await fs.promises.writeFile(tempAudioPath, audioBuffer);
          
          // 先转换为wav格式，然后获取时长（webm格式可能导致ffprobe读取不准确）
          await execAsync(`ffmpeg -i "${tempAudioPath}" -ar 44100 -ac 2 "${wavPath}"`);
          
          // 使用ffprobe获取wav音频时长
          const { stdout } = await execAsync(`ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${wavPath}"`);
          const parsedDuration = parseFloat(stdout.trim());
          
          if (!isNaN(parsedDuration) && parsedDuration > 0) {
            duration = parsedDuration;
            console.log(`音频段落${index} (${section.type}) 实际时长: ${duration.toFixed(2)}秒`);
          } else {
            console.warn(`音频段落${index}时长解析失败，使用默认值${duration}秒`);
          }
          
          // 清理临时文件
          await fs.promises.unlink(tempAudioPath).catch(() => {});
          await fs.promises.unlink(wavPath).catch(() => {});
        } catch (error) {
          console.warn(`获取音频${index}时长失败，使用默认值${duration}秒:`, error);
        }
      } else if (section.isTTS && section.text) {
        // TTS段落根据文本长度估算时长
        const estimatedDuration = Math.max(2, section.text.length / 4);
        duration = estimatedDuration;
        console.log(`TTS段落${index} (${section.type}) 估算时长: ${duration.toFixed(2)}秒`);
      }
      
      return { ...section, duration };
    })
  );
  
  // 阶段1: 显示空白等级结构
  const introSection = audioSectionsWithDuration.find(s => s.type === 'intro');
  const introDuration = introSection?.duration || 3;
  const introFrames = Math.floor(introDuration * fps);
  
  for (let i = 0; i < introFrames; i++) {
    drawBlankTierStructure(ctx, rankingData.tiers);
    await saveFrame(canvas, tempDir, frameIndex++);
  }
  
  // 阶段2: 按拖拽历史顺序逐项移动动画
  let allItems: any[] = [];
  
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
    const tierIndex = rankingData.tiers.findIndex(t => t.name === item.tierName);
    const targetItemIndex = tier?.items.findIndex((i: any) => i.id === item.id) || 0;
    
    // 检查是否需要位置替换动画
    // 当新项目插入到等级中间位置时，后面的项目需要被挤压
    const needsPositionReplacement = tier && tier.items.length > 1 && targetItemIndex < tier.items.length - 1;
    

    
    for (let frame = 0; frame < itemFrames; frame++) {
      const progress = frame / itemFrames;
      
      // 绘制背景和等级结构
      drawBlankTierStructure(ctx, rankingData.tiers);
      
      // 绘制已放置的项目（考虑位置替换动画）
      // 按等级分组已放置的项目
      const placedItemsByTier = new Map<string, any[]>();
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
        await drawMovingItemWithCenterStage(ctx, item, progress, rankingData.tiers, itemDuration);
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

function drawBlankTierStructure(ctx: any, tiers: any[]) {
  // 清空画布 - 使用浅灰色背景
  ctx.fillStyle = '#f3f4f6';
  ctx.fillRect(0, 0, 1920, 1080);
  
  // 绘制标题
  ctx.fillStyle = '#1f2937';
  ctx.font = 'bold 48px "Microsoft YaHei", "SimHei", Arial, sans-serif';
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
    ctx.font = 'bold 32px "Microsoft YaHei", "SimHei", Arial, sans-serif';
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



async function drawItemInTier(ctx: any, item: any, x: number, y: number, width: number, height: number) {
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
      ctx.font = 'bold 12px "Microsoft YaHei", "SimHei", Arial, sans-serif';
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

function drawDefaultItemStyle(ctx: any, item: any, x: number, y: number, width: number, height: number) {
  // 绘制渐变背景
  const gradient = ctx.createLinearGradient(x, y, x + width, y + height);
  gradient.addColorStop(0, '#3b82f6');
  gradient.addColorStop(1, '#8b5cf6');
  ctx.fillStyle = gradient;
  ctx.fillRect(x + 5, y + 5, width - 10, height - 10);
  
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 14px "Microsoft YaHei", "SimHei", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(item.name, x + width / 2, y + height / 2 + 5);
}

async function drawMovingItemWithCenterStage(ctx: any, item: any, progress: number, tiers: any[], duration: number) {
  const tier = tiers.find(t => t.name === item.tierName);
  if (!tier) return;
  
  const tierIndex = tiers.findIndex(t => t.name === item.tierName);
  const itemIndex = tier.items.findIndex((i: any) => i.id === item.id);
  
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

async function drawMovingItem(ctx: any, item: any, progress: number, tiers: any[]) {
  // 简化的移动动画，从屏幕底部移动到目标位置
  const startX = 960;
  const startY = 1000;
  
  const tier = tiers.find(t => t.name === item.tierName);
  if (!tier) return;
  
  const tierIndex = tiers.findIndex(t => t.name === item.tierName);
  const itemIndex = tier.items.findIndex((i: any) => i.id === item.id);
  
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

async function drawMovingItemContent(ctx: any, item: any, x: number, y: number, size: number) {
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
      ctx.font = `bold ${fontSize}px "Microsoft YaHei", "SimHei", Arial, sans-serif`;
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

function drawMovingItemDefaultStyle(ctx: any, item: any, x: number, y: number, size: number = 100) {
  // 绘制移动中的项目渐变背景
  const padding = Math.max(5, size * 0.05);
  const gradient = ctx.createLinearGradient(x, y, x + size, y + size);
  gradient.addColorStop(0, '#f59e0b');
  gradient.addColorStop(1, '#d97706');
  ctx.fillStyle = gradient;
  ctx.fillRect(x + padding, y + padding, size - padding * 2, size - padding * 2);
  
  ctx.fillStyle = '#ffffff';
  const fontSize = Math.max(14, size * 0.14);
  ctx.font = `bold ${fontSize}px "Microsoft YaHei", "SimHei", Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(item.name, x + size / 2, y + size / 2 + fontSize / 3);
}

async function drawCompleteTierTable(ctx: any, rankingData: RankingData) {
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

async function saveFrame(canvas: any, tempDir: string, frameIndex: number) {
  const buffer = canvas.toBuffer('image/png');
  const framePath = path.join(tempDir, `frame_${frameIndex.toString().padStart(6, '0')}.png`);
  await fs.promises.writeFile(framePath, buffer);
}

async function processAudio(audioSections: AudioSection[], tempDir: string): Promise<string> {
  const audioFiles: string[] = [];
  
  // 处理每个音频段落
  for (let i = 0; i < audioSections.length; i++) {
    const section = audioSections[i];
    const sectionPath = path.join(tempDir, `audio_section_${i}.wav`);
    
    if (section.audioBlob && typeof section.audioBlob === 'string') {
      // 处理base64编码的音频数据
      const base64Data = section.audioBlob.split(',')[1]; // 移除data:audio/...;base64,前缀
      const audioBuffer = Buffer.from(base64Data, 'base64');
      const tempAudioPath = path.join(tempDir, `temp_audio_${i}.webm`);
      
      // 保存原始音频文件
      await fs.promises.writeFile(tempAudioPath, audioBuffer);
      
      // 转换为wav格式
      await execAsync(`ffmpeg -i "${tempAudioPath}" -ar 44100 -ac 2 "${sectionPath}"`);
      
      // 删除临时文件
      await fs.promises.unlink(tempAudioPath);
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
      
      await execAsync(`ffmpeg -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 -t ${duration} "${sectionPath}"`);
    }
    
    audioFiles.push(sectionPath);
  }
  
  // 如果只有一个音频文件，直接返回
  if (audioFiles.length === 1) {
    return audioFiles[0];
  }
  
  // 合并所有音频文件
  const finalAudioPath = path.join(tempDir, 'final_audio.wav');
  const concatListPath = path.join(tempDir, 'audio_list.txt');
  
  // 创建ffmpeg concat列表文件
  const concatList = audioFiles.map(file => `file '${file.replace(/\\/g, '/')}'`).join('\n');
  await fs.promises.writeFile(concatListPath, concatList);
  
  // 使用ffmpeg合并音频
  await execAsync(`ffmpeg -f concat -safe 0 -i "${concatListPath}" -c copy "${finalAudioPath}"`);
  
  return finalAudioPath;
}

async function generateVideoWithFFmpeg(
  tempDir: string,
  frameCount: number,
  audioPath: string
): Promise<string> {
  const videoPath = path.join(tempDir, 'output.mp4');
  const framesPattern = path.join(tempDir, 'frame_%06d.png');
  
  // 使用ffmpeg合成视频
  const command = `ffmpeg -framerate 30 -i "${framesPattern}" -i "${audioPath}" -c:v libx264 -c:a aac -pix_fmt yuv420p -shortest "${videoPath}"`;
  
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
'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { PlayIcon, PauseIcon, StopIcon, MicrophoneIcon, SpeakerWaveIcon, VideoCameraIcon } from '@heroicons/react/24/outline';

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

interface DragHistoryEntry {
  itemId: string;
  itemName: string;
  targetTierId: string;
  targetTierName: string;
  timestamp: number;
}

interface RankingData {
  tiers: Tier[];
  unrankedItems: Item[];
  dragHistory?: DragHistoryEntry[];
}

interface AudioSection {
  type: 'intro' | 'item' | 'conclusion';
  text: string;
  audioBlob?: Blob;
  audioUrl?: string;
  duration: number;
  isTTS?: boolean;
  itemId?: string;
  itemName?: string;
  tierName?: string;
}

function VideoExportContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [rankingData, setRankingData] = useState<RankingData | null>(null);
  const [audioSections, setAudioSections] = useState<AudioSection[]>([]);
  const [currentSection, setCurrentSection] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);
  const [audioMode, setAudioMode] = useState<'record' | 'tts' | 'upload'>('record');
  const [speakers, setSpeakers] = useState<string[]>([]);
  const [selectedSpeaker, setSelectedSpeaker] = useState('default');
  const [previewMode, setPreviewMode] = useState<'blank' | 'current' | 'complete'>('blank');
  const [title, setTitle] = useState('从夯到拉排行榜');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editingTitle, setEditingTitle] = useState('从夯到拉排行榜');
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [batchGenerating, setBatchGenerating] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });
  const [batchOverwrite, setBatchOverwrite] = useState(false);

  // 从localStorage加载标题
  useEffect(() => {
    const savedTitle = localStorage.getItem('rankingTitle');
    if (savedTitle) {
      setTitle(savedTitle);
      setEditingTitle(savedTitle);
    }
  }, []);
  
  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

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

  useEffect(() => {
    // 优先从 sessionStorage 读取数据，避免使用过长的 URL
    let data: RankingData | null = null;
    try {
      const stored = sessionStorage.getItem('videoExportData');
      if (stored) {
        data = JSON.parse(stored);
        // 读取一次后清理，避免过期数据影响后续导出
        sessionStorage.removeItem('videoExportData');
      }
    } catch (e) {
      console.warn('读取 sessionStorage 中的导出数据失败:', e);
    }

    // 其次从 localStorage 读取（兼容新标签页打开的情况）
    if (!data) {
      try {
        const lsStored = localStorage.getItem('videoExportData');
        if (lsStored) {
          data = JSON.parse(lsStored);
          // 读取后清理，避免污染后续导出流程
          localStorage.removeItem('videoExportData');
        }
      } catch (e) {
        console.warn('读取 localStorage 中的导出数据失败:', e);
      }
    }

    // 回退：从URL参数获取排列数据（兼容旧链接）
    if (!data) {
      const dataParam = searchParams.get('data');
      if (dataParam) {
        try {
          data = JSON.parse(decodeURIComponent(dataParam));
        } catch (error) {
          console.error('Failed to parse ranking data from URL:', error);
        }
      }
    }

    if (data) {
      setRankingData(data);
      initializeAudioSections(data);
    } else {
      router.push('/');
    }
    
    // 定义加载说话人列表的函数
    const loadSpeakers = async () => {
      try {
        const response = await fetch('/api/speakers');
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.speakers) {
            setSpeakers(data.speakers);
            // 如果有说话人列表，设置第一个为默认选择
            if (data.speakers.length > 0) {
              setSelectedSpeaker(data.speakers[0]);
            }
          }
        }
      } catch (error) {
        console.error('加载说话人列表失败:', error);
      }
    };
    
    // 加载说话人列表（用于TTS）
    loadSpeakers();
    
    if ('speechSynthesis' in window) {
      const loadVoices = () => {
        const voices = speechSynthesis.getVoices();
        console.log('可用语音:', voices.map(v => `${v.name} (${v.lang})`));
      };
      
      // 语音列表可能需要异步加载
      if (speechSynthesis.getVoices().length > 0) {
        loadVoices();
      } else {
        speechSynthesis.onvoiceschanged = loadVoices;
      }
    }
  }, [searchParams, router]);

  const initializeAudioSections = (data: RankingData) => {
    const sections: AudioSection[] = [];
    
    // 前言
    sections.push({
      type: 'intro',
      text: '欢迎观看我的等级排行榜！接下来我将为大家介绍每个项目的排名理由。',
      duration: 3 // 默认3秒
    });
    
    // 按拖拽历史顺序为每个已分类的项目创建音频段
    if (data.dragHistory && data.dragHistory.length > 0) {
      // 按时间戳排序拖拽历史
      const sortedHistory = [...data.dragHistory].sort((a, b) => a.timestamp - b.timestamp);
      
      sortedHistory.forEach(historyEntry => {
        // 查找对应的项目和等级信息
        const tier = data.tiers.find(t => t.id === historyEntry.targetTierId);
        const item = tier?.items.find(i => i.id === historyEntry.itemId);
        
        if (item && tier) {
          sections.push({
            type: 'item',
            text: `${item.name}被我放在了${tier.name}级别，理由是...`,
            itemId: item.id,
            itemName: item.name,
            tierName: tier.name,
            duration: 4 // 默认4秒，给用户足够时间解释
          });
        }
      });
    } else {
      // 如果没有拖拽历史，回退到原来的按等级顺序
      data.tiers.forEach(tier => {
        tier.items.forEach(item => {
          sections.push({
            type: 'item',
            text: `${item.name}被我放在了${tier.name}级别，理由是...`,
            itemId: item.id,
            itemName: item.name,
            tierName: tier.name,
            duration: 4 // 默认4秒，给用户足够时间解释
          });
        });
      });
    }
    
    // 总结
    sections.push({
      type: 'conclusion',
      text: '以上就是我的排行榜分析，感谢大家观看！',
      duration: 3 // 默认3秒
    });
    
    setAudioSections(sections);
  };

  const startRecording = async () => {
    try {
      // 检查浏览器是否支持媒体录制
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('您的浏览器不支持音频录制功能');
        return;
      }
      
      // 请求麦克风权限
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      
      // 检查MediaRecorder支持
      if (!MediaRecorder.isTypeSupported('audio/webm')) {
        console.warn('audio/webm not supported, falling back to default');
      }
      
      const recorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : undefined
      });
      const chunks: BlobPart[] = [];
      
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };
      
      recorder.onstop = () => {
        const mimeType = recorder.mimeType || 'audio/webm';
        const audioBlob = new Blob(chunks, { type: mimeType });
        const audioUrl = URL.createObjectURL(audioBlob);
        
        setAudioSections(prev => prev.map((section, index) => 
          index === currentSection 
            ? { ...section, audioBlob, audioUrl }
            : section
        ));
        
        // 停止所有音频轨道
        stream.getTracks().forEach(track => {
          track.stop();
        });
        
        console.log('录制完成，音频大小:', audioBlob.size, 'bytes');
      };
      
      recorder.onerror = (event) => {
        console.error('录制错误:', event.error);
        alert('录制过程中发生错误，请重试');
        setIsRecording(false);
        setMediaRecorder(null);
      };
      
      recorder.start(1000); // 每秒收集一次数据
      setMediaRecorder(recorder);
      setIsRecording(true);
      
      console.log('开始录制音频');
    } catch (error) {
      console.error('Failed to start recording:', error);
      
      let errorMessage = '无法访问麦克风';
      if (error instanceof Error) {
        if (error.name === 'NotAllowedError') {
          errorMessage = '麦克风权限被拒绝，请在浏览器设置中允许麦克风访问';
        } else if (error.name === 'NotFoundError') {
          errorMessage = '未找到麦克风设备，请检查设备连接';
        } else if (error.name === 'NotSupportedError') {
          errorMessage = '您的浏览器不支持音频录制功能';
        }
      }
      
      alert(errorMessage);
    }
  };

  const stopRecording = () => {
    if (mediaRecorder && isRecording) {
      mediaRecorder.stop();
      setIsRecording(false);
      setMediaRecorder(null);
    }
  };

  const handleAudioUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    // 检查文件类型
    if (!file.type.startsWith('audio/')) {
      alert('请选择音频文件');
      return;
    }
    
    // 检查文件大小（限制为50MB）
    const maxSize = 50 * 1024 * 1024; // 50MB
    if (file.size > maxSize) {
      alert('文件大小不能超过50MB');
      return;
    }
    
    const audioUrl = URL.createObjectURL(file);
    
    // 创建音频元素来获取时长
    const audio = new Audio(audioUrl);
    audio.onloadedmetadata = () => {
      const duration = audio.duration;
      
      setAudioSections(prev => prev.map((section, index) => 
        index === currentSection 
          ? { 
              ...section, 
              audioBlob: file,
              audioUrl,
              duration: duration || section.duration
            }
          : section
      ));
      
      console.log('音频文件上传成功，时长:', duration, '秒');
    };
    
    audio.onerror = () => {
      alert('音频文件格式不支持或文件损坏');
      URL.revokeObjectURL(audioUrl);
    };
    
    // 清空input值，允许重复选择同一文件
    event.target.value = '';
  };

  const generateTTS = async (text: string, sectionIndex: number, isBatch: boolean = false) => {
    try {
      if (!text.trim()) {
        if (!isBatch) {
          alert('请输入要转换的文本内容');
        }
        return;
      }

      console.log('开始生成TTS音频...');
      
      // 调用后端TTS API
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: text,
          speaker: selectedSpeaker
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'TTS API调用失败');
      }

      const result = await response.json();
      
      if (!result.success || !result.audioUrl) {
        throw new Error('TTS生成失败，未获取到音频数据');
      }

      // 将base64音频数据转换为Blob
      const base64Data = result.audioUrl.split(',')[1];
      const mimeType = result.audioUrl.split(';')[0].split(':')[1];
      const audioBlob = new Blob([Uint8Array.from(atob(base64Data), c => c.charCodeAt(0))], { type: mimeType });
      const audioUrl = URL.createObjectURL(audioBlob);

      // 更新音频段落
      setAudioSections(prev => prev.map((section, index) => 
        index === sectionIndex 
          ? { 
              ...section, 
              text, 
              isTTS: true, 
              audioBlob,
              audioUrl,
              duration: result.duration || section.duration
            }
          : section
      ));
      
      console.log('TTS音频生成完成，时长:', result.duration, '秒');
      // 只在非批量生成模式下显示成功提示
      if (!isBatch) {
        alert('TTS音频生成成功！');
      }
      
    } catch (error) {
      console.error('TTS generation failed:', error);
      if (!isBatch) {
        alert(`TTS生成失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
      throw error;
    }
  };

  const generateAllTTS = async () => {
    setShowBatchModal(false); // 关闭弹窗
    setBatchGenerating(true);
    setBatchProgress({ current: 0, total: audioSections.length });
    
    let successCount = 0;
    let errorCount = 0;
    const errors: string[] = [];
    
    try {
      for (let i = 0; i < audioSections.length; i++) {
        const section = audioSections[i];
        
        // 如果已有音频且不覆盖，则跳过
        if (section.audioUrl && !batchOverwrite) {
          setBatchProgress({ current: i + 1, total: audioSections.length });
          continue;
        }
        
        // 如果文本为空，跳过
        if (!section.text.trim()) {
          setBatchProgress({ current: i + 1, total: audioSections.length });
          continue;
        }
        
        try {
          await generateTTS(section.text, i, true); // 传入isBatch=true
          successCount++;
        } catch (error) {
          errorCount++;
          errors.push(`段落 ${i + 1}: ${error instanceof Error ? error.message : '未知错误'}`);
        }
        
        setBatchProgress({ current: i + 1, total: audioSections.length });
        
        // 添加短暂延迟避免API请求过于频繁
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      // 显示结果（仅在有错误时显示详细信息）
      if (errorCount > 0) {
        let message = `批量生成完成！\n成功: ${successCount} 个，失败: ${errorCount} 个`;
        if (errors.length > 0) {
          message += `\n错误详情:\n${errors.slice(0, 3).join('\n')}`;
          if (errors.length > 3) {
            message += `\n... 还有 ${errors.length - 3} 个错误`;
          }
        }
        alert(message);
      }
      
    } catch (error) {
      console.error('批量生成过程中发生错误:', error);
      alert('批量生成过程中发生错误，请重试');
    } finally {
      setBatchGenerating(false);
      setBatchProgress({ current: 0, total: 0 });
    }
  };

  const playAudio = (audioUrl: string) => {
    if (audioRef.current) {
      audioRef.current.src = audioUrl;
      audioRef.current.play();
    }
  };

  const generateVideo = async () => {
    if (!rankingData) return;
    
    setIsGeneratingVideo(true);
    
    try {
      console.log('开始上传图片...');
      
      // 先上传所有图片获取URL
      const uploadedRankingData = {
        ...rankingData,
        tiers: await Promise.all(rankingData.tiers.map(async tier => ({
          ...tier,
          items: await Promise.all(tier.items.map(async item => {
            if (item.image && item.image.startsWith('data:')) {
              console.log(`正在上传图片: ${item.name}`);
              // 上传base64图片获取URL
              const imageUrl = await uploadImage(item.image, item.name);
              console.log(`图片上传结果: ${item.name} -> ${imageUrl.startsWith('/api/') ? '成功' : '失败'}`);
              return { ...item, image: imageUrl };
            }
            return item;
          }))
        }))),
        unrankedItems: await Promise.all(rankingData.unrankedItems.map(async item => {
          if (item.image && item.image.startsWith('data:')) {
            console.log(`正在上传图片: ${item.name}`);
            // 上传base64图片获取URL
            const imageUrl = await uploadImage(item.image, item.name);
            console.log(`图片上传结果: ${item.name} -> ${imageUrl.startsWith('/api/') ? '成功' : '失败'}`);
            return { ...item, image: imageUrl };
          }
          return item;
        }))
      };
      
      console.log('所有图片上传完成，准备发送请求...');
      
      // 准备发送到后端的数据
      const requestData = {
        rankingData: uploadedRankingData,
        audioSections: await Promise.all(audioSections.map(async section => ({
          ...section,
          // 将audioBlob转换为base64
          audioBlob: section.audioBlob ? await blobToBase64(section.audioBlob) : null
        })))
      };
      
      // 检查最终数据中是否还有base64图片
      const hasBase64Images = JSON.stringify(requestData).includes('data:image/');
      console.log('请求数据中是否包含base64图片:', hasBase64Images);
      
      if (hasBase64Images) {
        console.error('警告：请求数据中仍然包含base64图片数据！');
        alert('图片上传可能失败，请检查控制台日志');
        return;
      }
      
      // 调用后端API生成视频
      const response = await fetch('/api/generate-video', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestData),
      });
      
      if (!response.ok) {
        throw new Error('视频生成失败');
      }
      
      // 下载生成的视频文件
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tier-ranking-${Date.now()}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      
      alert('视频生成并下载完成！');
    } catch (error) {
      console.error('视频生成失败:', error);
      alert('视频生成失败，请重试');
    } finally {
      setIsGeneratingVideo(false);
    }
  };
  


  // 辅助函数：将Blob转换为base64
  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  // 上传图片获取URL
  const uploadImage = async (imageData: string, fileName: string): Promise<string> => {
    try {
      const response = await fetch('/api/upload-image', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          imageData,
          fileName
        })
      });

      if (!response.ok) {
        throw new Error('图片上传失败');
      }

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error || '图片上传失败');
      }

      return result.imageUrl;
    } catch (error) {
      console.error('图片上传失败:', error);
      // 如果上传失败，返回原始base64数据作为备用
      return imageData;
    }
  };

  const updateSectionText = (index: number, text: string) => {
    setAudioSections(prev => prev.map((section, i) => 
      i === index ? { ...section, text } : section
    ));
  };

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

  // Canvas绘制函数
  const drawBlankTierStructure = (ctx: CanvasRenderingContext2D, tiers: Tier[]) => {
    const canvas = ctx.canvas;
    const scale = canvas.width / 1920; // 缩放比例
    
    // 清空画布 - 使用浅灰色背景
    ctx.fillStyle = '#f3f4f6';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // 绘制标题
    ctx.fillStyle = '#1f2937';
    ctx.font = `bold ${48 * scale}px "Microsoft YaHei", "SimHei", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(title, canvas.width / 2, 80 * scale);
    
    // 绘制等级行
    const tierHeight = 120 * scale;
    const startY = 150 * scale;
    
    tiers.forEach((tier, index) => {
      const y = startY + index * (tierHeight + 20 * scale);
      
      // 绘制等级标签
      const hexColor = colorMap[tier.color] || '#9ca3af';
      ctx.fillStyle = hexColor;
      ctx.fillRect(50 * scale, y, 200 * scale, tierHeight);
      
      // 添加边框
      ctx.strokeStyle = '#d1d5db';
      ctx.lineWidth = 2 * scale;
      ctx.strokeRect(50 * scale, y, 200 * scale, tierHeight);
      
      ctx.fillStyle = '#1f2937';
      ctx.font = `bold ${32 * scale}px "Microsoft YaHei", "SimHei", Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(tier.name, 150 * scale, y + tierHeight / 2 + 12 * scale);
      
      // 绘制等级内容区域
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(270 * scale, y, 1600 * scale, tierHeight);
      ctx.strokeStyle = '#d1d5db';
      ctx.lineWidth = 2 * scale;
      ctx.strokeRect(270 * scale, y, 1600 * scale, tierHeight);
    });
  };

  const drawItemInTier = async (ctx: CanvasRenderingContext2D, item: Item, tiers: Tier[], tierName: string) => {
    const canvas = ctx.canvas;
    const scale = canvas.width / 1920;
    
    const tier = tiers.find(t => t.name === tierName);
    if (!tier) return;
    
    const tierIndex = tiers.findIndex(t => t.name === tierName);
    const itemIndex = tier.items.findIndex((i: Item) => i.id === item.id);
    
    const tierHeight = 120 * scale;
    const startY = 150 * scale;
    const y = startY + tierIndex * (tierHeight + 20 * scale);
    const x = (290 + itemIndex * 110) * scale;
    
    // 绘制项目背景
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y + 10 * scale, 100 * scale, 100 * scale);
    
    // 绘制项目边框
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 2 * scale;
    ctx.strokeRect(x, y + 10 * scale, 100 * scale, 100 * scale);
    
    if (item.image) {
      // 如果有图片，绘制图片
      try {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        
        await new Promise((resolve, reject) => {
          img.onload = () => {
            // 绘制图片，保持宽高比
            const imgSize = 80 * scale;
            const imgX = x + 10 * scale;
            const imgY = y + 20 * scale;
            
            ctx.save();
            ctx.beginPath();
            ctx.roundRect(imgX, imgY, imgSize, imgSize, 4 * scale);
            ctx.clip();
            
            // 计算图片缩放以填充区域
            const aspectRatio = img.width / img.height;
            let drawWidth = imgSize;
            let drawHeight = imgSize;
            let drawX = imgX;
            let drawY = imgY;
            
            if (aspectRatio > 1) {
              // 宽图片
              drawHeight = imgSize;
              drawWidth = drawHeight * aspectRatio;
              drawX = imgX - (drawWidth - imgSize) / 2;
            } else {
              // 高图片
              drawWidth = imgSize;
              drawHeight = drawWidth / aspectRatio;
              drawY = imgY - (drawHeight - imgSize) / 2;
            }
            
            ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
            ctx.restore();
            
            // 绘制项目名称在图片下方
            ctx.fillStyle = '#1f2937';
            ctx.font = `bold ${12 * scale}px "Microsoft YaHei", "SimHei", Arial, sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillText(item.name, x + 50 * scale, y + 110 * scale);
            
            resolve(true);
          };
          img.onerror = () => {
            reject(new Error('图片加载失败'));
          };
        });
        
        img.src = item.image;
      } catch (error) {
        console.warn('图片加载失败，使用默认样式:', error);
        // 图片加载失败时使用默认样式
        drawDefaultItemStyle();
      }
    } else {
      // 没有图片时使用默认样式
      drawDefaultItemStyle();
    }
    
    function drawDefaultItemStyle() {
      // 绘制渐变背景
      const gradient = ctx.createLinearGradient(x, y + 10 * scale, x + 100 * scale, y + 110 * scale);
      gradient.addColorStop(0, '#3b82f6');
      gradient.addColorStop(1, '#8b5cf6');
      ctx.fillStyle = gradient;
      ctx.fillRect(x + 5 * scale, y + 15 * scale, 90 * scale, 90 * scale);
      
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${14 * scale}px "Microsoft YaHei", "SimHei", Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(item.name, x + 50 * scale, y + 65 * scale);
    }
  };

  const drawCompleteTierTable = async (ctx: CanvasRenderingContext2D, rankingData: RankingData) => {
    drawBlankTierStructure(ctx, rankingData.tiers);
    
    // 绘制所有项目在其最终位置
    for (const tier of rankingData.tiers) {
      for (const item of tier.items) {
        await drawItemInTier(ctx, item, rankingData.tiers, tier.name);
      }
    }
  };

  const updatePreview = async () => {
    if (!canvasRef.current || !rankingData) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // 设置Canvas尺寸
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    
    switch (previewMode) {
      case 'blank':
        drawBlankTierStructure(ctx, rankingData.tiers);
        break;
      case 'current':
        drawBlankTierStructure(ctx, rankingData.tiers);
        // 绘制当前段落对应的项目
        const currentAudioSection = audioSections[currentSection];
        if (currentAudioSection?.type === 'item' && currentAudioSection.itemId && currentAudioSection.tierName) {
          // 找到对应的项目
          const tier = rankingData.tiers.find(t => t.name === currentAudioSection.tierName);
          const item = tier?.items.find(i => i.id === currentAudioSection.itemId);
          if (item && tier) {
            await drawItemInTier(ctx, item, rankingData.tiers, tier.name);
          }
        }
        break;
      case 'complete':
        await drawCompleteTierTable(ctx, rankingData);
        break;
    }
  };

  // 监听预览模式和当前段落变化
  useEffect(() => {
    updatePreview();
  }, [previewMode, currentSection, rankingData]);

  // 监听Canvas尺寸变化
  useEffect(() => {
    const handleResize = async () => {
      await updatePreview();
    };
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [previewMode, currentSection, rankingData]);

  // 初始化预览
  useEffect(() => {
    if (rankingData && canvasRef.current) {
      // 延迟一帧确保Canvas已经渲染
      requestAnimationFrame(async () => {
        await updatePreview();
      });
    }
  }, [rankingData]);

  if (!rankingData) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-500 mx-auto"></div>
          <p className="mt-4 text-gray-600">加载排列数据中...</p>
        </div>
      </div>
    );
  }

  const currentAudioSection = audioSections[currentSection];

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="max-w-6xl mx-auto">
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
              {title} - 视频导出
            </h1>
          )}
          <button
            onClick={() => router.push('/')}
            className="px-4 py-2 bg-gray-500 text-white rounded-md hover:bg-gray-600 transition-colors"
          >
            返回排行榜
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* 左侧：音频录制区域 */}
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-xl font-semibold mb-4">音频录制</h2>
            
            {/* 音频模式选择 */}
            <div className="mb-6">
              <div className="flex items-center space-x-4 flex-wrap">
                <label className="flex items-center">
                  <input
                    type="radio"
                    checked={audioMode === 'record'}
                    onChange={() => setAudioMode('record')}
                    className="mr-2"
                  />
                  <MicrophoneIcon className="w-5 h-5 mr-1" />
                  录音
                </label>
                <label className="flex items-center">
                  <input
                    type="radio"
                    checked={audioMode === 'tts'}
                    onChange={() => setAudioMode('tts')}
                    className="mr-2"
                  />
                  <SpeakerWaveIcon className="w-5 h-5 mr-1" />
                  TTS语音合成
                </label>
                <label className="flex items-center">
                  <input
                    type="radio"
                    checked={audioMode === 'upload'}
                    onChange={() => setAudioMode('upload')}
                    className="mr-2"
                  />
                  <svg className="w-5 h-5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  上传音频
                </label>
              </div>
            </div>

            {/* 当前段落 */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-medium">
                  {currentAudioSection?.type === 'intro' && '前言'}
                  {currentAudioSection?.type === 'item' && `${currentAudioSection.itemName} - ${currentAudioSection.tierName} - 项目解说`}
                  {currentAudioSection?.type === 'conclusion' && '总结'}
                </h3>
                <span className="text-sm text-gray-500">
                  {currentSection + 1} / {audioSections.length}
                </span>
              </div>
              
              <textarea
                value={currentAudioSection?.text || ''}
                onChange={(e) => updateSectionText(currentSection, e.target.value)}
                className="w-full h-32 p-3 border border-gray-300 rounded-md resize-none"
                placeholder="输入解说内容..."
              />
            </div>

            {/* 录制控制 */}
            <div className="flex items-center space-x-4 mb-6">
              {audioMode === 'record' ? (
                <>
                  <button
                    onClick={isRecording ? stopRecording : startRecording}
                    className={`px-4 py-2 rounded-md flex items-center space-x-2 ${
                      isRecording 
                        ? 'bg-red-500 hover:bg-red-600 text-white' 
                        : 'bg-blue-500 hover:bg-blue-600 text-white'
                    }`}
                  >
                    {isRecording ? (
                      <>
                        <StopIcon className="w-5 h-5" />
                        <span>停止录制</span>
                      </>
                    ) : (
                      <>
                        <MicrophoneIcon className="w-5 h-5" />
                        <span>开始录制</span>
                      </>
                    )}
                  </button>
                </>
              ) : audioMode === 'tts' ? (
                <div className="flex items-center space-x-4">
                  {/* 说话人选择下拉列表 */}
                  <div className="flex flex-col">
                    <label className="text-sm text-gray-600 mb-1">选择说话人:</label>
                    <select
                      value={selectedSpeaker}
                      onChange={(e) => setSelectedSpeaker(e.target.value)}
                      className="px-3 py-2 border border-gray-300 rounded-md bg-white text-sm min-w-[150px]"
                    >
                      {speakers.length > 0 ? (
                        speakers.map((speaker, index) => {
                          const label = speaker.startsWith('speech:')
                            ? (speaker.split(':')[1] || speaker)
                            : speaker;
                          return (
                            <option key={index} value={speaker}>
                              {label}
                            </option>
                          );
                        })
                      ) : (
                        <option value="default">默认说话人</option>
                      )}
                    </select>
                  </div>
                  
                  <button
                    onClick={() => generateTTS(currentAudioSection?.text || '', currentSection)}
                    className="px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600 flex items-center space-x-2"
                  >
                    <SpeakerWaveIcon className="w-5 h-5" />
                    <span>生成语音</span>
                  </button>
                  
                  <button
                    onClick={() => setShowBatchModal(true)}
                    disabled={batchGenerating}
                    className="px-4 py-2 bg-purple-500 text-white rounded-md hover:bg-purple-600 disabled:bg-gray-400 flex items-center space-x-2"
                  >
                    <SpeakerWaveIcon className="w-5 h-5" />
                    <span>一键生成全部</span>
                  </button>
                </div>
              ) : (
                <div className="flex items-center space-x-4">
                  <input
                    type="file"
                    accept="audio/*"
                    onChange={handleAudioUpload}
                    className="hidden"
                    id="audio-upload"
                  />
                  <label
                    htmlFor="audio-upload"
                    className="px-4 py-2 bg-orange-500 text-white rounded-md hover:bg-orange-600 cursor-pointer flex items-center space-x-2"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    <span>选择音频文件</span>
                  </label>
                </div>
              )}
              
              {currentAudioSection?.audioUrl && (
                <button
                  onClick={() => playAudio(currentAudioSection.audioUrl!)}
                  className="px-4 py-2 bg-gray-500 text-white rounded-md hover:bg-gray-600 flex items-center space-x-2"
                >
                  <PlayIcon className="w-5 h-5" />
                  <span>播放</span>
                </button>
              )}
            </div>

            {/* 批量生成进度 */}
            {batchGenerating && (
              <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-md">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-blue-800">正在批量生成语音...</span>
                  <span className="text-sm text-blue-600">{batchProgress.current} / {batchProgress.total}</span>
                </div>
                <div className="w-full bg-blue-200 rounded-full h-2">
                  <div 
                    className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${batchProgress.total > 0 ? (batchProgress.current / batchProgress.total) * 100 : 0}%` }}
                  ></div>
                </div>
              </div>
            )}

            {/* 段落导航 */}
            <div className="flex items-center space-x-2 mb-6">
              <button
                onClick={() => setCurrentSection(Math.max(0, currentSection - 1))}
                disabled={currentSection === 0}
                className="px-3 py-1 bg-gray-300 text-gray-700 rounded disabled:opacity-50"
              >
                上一段
              </button>
              <button
                onClick={() => setCurrentSection(Math.min(audioSections.length - 1, currentSection + 1))}
                disabled={currentSection === audioSections.length - 1}
                className="px-3 py-1 bg-gray-300 text-gray-700 rounded disabled:opacity-50"
              >
                下一段
              </button>
            </div>

            {/* 音频段落列表 */}
            <div className="space-y-2">
              {audioSections.map((section, index) => (
                <div
                  key={index}
                  className={`p-3 rounded-md border cursor-pointer ${
                    index === currentSection 
                      ? 'border-blue-500 bg-blue-50' 
                      : 'border-gray-200 hover:bg-gray-50'
                  }`}
                  onClick={() => setCurrentSection(index)}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">
                      {section.type === 'intro' && '前言'}
                      {section.type === 'item' && `${section.itemName} - ${section.tierName} - 项目解说`}
                      {section.type === 'conclusion' && '总结'}
                    </span>
                    <div className="flex items-center space-x-2">
                      {section.audioUrl && (
                        <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                      )}
                      <span className="text-xs text-gray-500">{index + 1}</span>
                    </div>
                  </div>
                  <p className="text-sm text-gray-600 mt-1 truncate">{section.text}</p>
                </div>
              ))}
            </div>
          </div>

          {/* 右侧：视频预览区域 */}
          <div className="bg-white rounded-lg shadow-lg p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold">视频预览</h2>
              <div className="flex space-x-2">
                <button
                  onClick={() => setPreviewMode('blank')}
                  className={`px-3 py-1 rounded text-sm ${
                    previewMode === 'blank' 
                      ? 'bg-blue-500 text-white' 
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}
                >
                  空白结构
                </button>
                <button
                  onClick={() => setPreviewMode('current')}
                  className={`px-3 py-1 rounded text-sm ${
                    previewMode === 'current' 
                      ? 'bg-blue-500 text-white' 
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}
                >
                  当前段落
                </button>
                <button
                  onClick={() => setPreviewMode('complete')}
                  className={`px-3 py-1 rounded text-sm ${
                    previewMode === 'complete' 
                      ? 'bg-blue-500 text-white' 
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}
                >
                  完整结果
                </button>
              </div>
            </div>
            
            <div className="mb-6">
              <canvas
                ref={canvasRef}
                className="w-full border border-gray-300 rounded-md bg-white"
                style={{ aspectRatio: '16/9' }}
              />
            </div>
            
            <div className="mb-4 text-sm text-gray-600">
               当前段落: {currentSection + 1} / {audioSections.length} - {
                 audioSections[currentSection]?.type === 'intro' ? '前言' : 
                 audioSections[currentSection]?.type === 'conclusion' ? '总结' : 
                 `${audioSections[currentSection]?.itemName} - ${audioSections[currentSection]?.tierName} - 项目解说`
               }
             </div>

            <div className="space-y-4">
              <button
                onClick={generateVideo}
                disabled={isGeneratingVideo || audioSections.some(s => !s.audioUrl)}
                className="w-full px-6 py-3 bg-red-500 text-white rounded-md hover:bg-red-600 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
              >
                {isGeneratingVideo ? (
                  <>
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                    <span>生成中...</span>
                  </>
                ) : (
                  <>
                    <VideoCameraIcon className="w-5 h-5" />
                    <span>生成视频</span>
                  </>
                )}
              </button>
              
              {audioSections.some(s => !s.audioUrl) && (
                <p className="text-sm text-gray-500 text-center">
                    请先为所有段落录制音频、生成语音或上传音频文件
                  </p>
              )}
            </div>
          </div>
        </div>
      </div>
      
      {/* 批量生成选项弹窗 */}
      {showBatchModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">一键生成所有语音</h3>
            
            <div className="mb-6">
              <p className="text-gray-600 mb-4">
                将为所有段落生成TTS语音。请选择对已有语音的处理方式：
              </p>
              
              <div className="space-y-3">
                <label className="flex items-center">
                  <input
                    type="radio"
                    checked={!batchOverwrite}
                    onChange={() => setBatchOverwrite(false)}
                    className="mr-3"
                  />
                  <div>
                    <div className="font-medium">跳过已有语音</div>
                    <div className="text-sm text-gray-500">只为没有语音的段落生成TTS</div>
                  </div>
                </label>
                
                <label className="flex items-center">
                  <input
                    type="radio"
                    checked={batchOverwrite}
                    onChange={() => setBatchOverwrite(true)}
                    className="mr-3"
                  />
                  <div>
                    <div className="font-medium">覆盖所有语音</div>
                    <div className="text-sm text-gray-500">重新生成所有段落的TTS语音</div>
                  </div>
                </label>
              </div>
            </div>
            
            <div className="flex space-x-3">
              <button
                onClick={() => setShowBatchModal(false)}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={generateAllTTS}
                className="flex-1 px-4 py-2 bg-purple-500 text-white rounded-md hover:bg-purple-600"
              >
                开始生成
              </button>
            </div>
          </div>
        </div>
      )}
      
      <audio ref={audioRef} />
    </div>
  );
}

export default function VideoExportPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50 flex items-center justify-center"><div className="text-lg">加载中...</div></div>}>
      <VideoExportContent />
    </Suspense>
  );
}
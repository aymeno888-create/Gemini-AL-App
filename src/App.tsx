/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import { 
  Upload, 
  ImageIcon, 
  Zap, 
  Download, 
  Layers, 
  Box, 
  Monitor, 
  CheckCircle2, 
  AlertCircle,
  Settings2,
  Maximize2,
  Grid3X3,
  Cpu,
  Trash2,
  RefreshCw
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from './lib/utils';
import { GoogleGenAI } from "@google/genai";

// --- Types & Constants ---

type MapType = 'original' | 'albedo' | 'normal' | 'height' | 'roughness' | 'ao' | 'specular' | 'metallic';

interface MapSettings {
  intensity: number;
  contrast: number;
  blur: number;
  gamma: number;
  invert: boolean;
}

interface TextureMap {
  id: MapType;
  name: string;
  nameAr: string;
  description: string;
  status: 'idle' | 'generating' | 'done' | 'error';
  url?: string;
  settings: MapSettings;
}

const DEFAULT_SETTINGS: MapSettings = {
  intensity: 1.0,
  contrast: 1.0,
  blur: 0,
  gamma: 1.0,
  invert: false,
};

const INITIAL_MAPS: TextureMap[] = [
  { id: 'original', name: 'Original Enhanced', nameAr: 'خامة محسنة', description: 'Cleaned and upscaled base texture.', status: 'idle', settings: { ...DEFAULT_SETTINGS } },
  { id: 'albedo', name: 'Albedo / Base Color', nameAr: 'اللون الأساسي', description: 'Color data without lighting or shadows.', status: 'idle', settings: { ...DEFAULT_SETTINGS } },
  { id: 'normal', name: 'Normal Map', nameAr: 'خريطة الاتجاه', description: 'Surface orientation for light simulation.', status: 'idle', settings: { ...DEFAULT_SETTINGS, intensity: 2.0 } },
  { id: 'height', name: 'Displacement', nameAr: 'خريطة البروز', description: 'Grayscale relief for physical depth.', status: 'idle', settings: { ...DEFAULT_SETTINGS } },
  { id: 'roughness', name: 'Roughness', nameAr: 'الخشونة', description: 'Controls surface specular spread.', status: 'idle', settings: { ...DEFAULT_SETTINGS } },
  { id: 'ao', name: 'Ambient Occlusion', nameAr: 'الظلال الذاتية', description: 'Soft shadows in crevices.', status: 'idle', settings: { ...DEFAULT_SETTINGS, intensity: 1.5 } },
  { id: 'specular', name: 'Specular', nameAr: 'اللمعان', description: 'Defines reflectivity intensity.', status: 'idle', settings: { ...DEFAULT_SETTINGS, intensity: 0.8 } },
  { id: 'metallic', name: 'Metallic', nameAr: 'المعدنية', description: 'Defines conductive properties.', status: 'idle', settings: { ...DEFAULT_SETTINGS, intensity: 0 } },
];

// --- Generation Logic ---

const generateMap = (img: HTMLImageElement, map: TextureMap, resolution: string): string => {
  const canvas = document.createElement('canvas');
  const size = parseInt(resolution);
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return '';

  ctx.drawImage(img, 0, 0, size, size);
  const imageData = ctx.getImageData(0, 0, size, size);
  const data = imageData.data;
  const { intensity, contrast, gamma, invert } = map.settings;

  const applyPixel = (i: number, val: number) => {
    let v = val / 255;
    // Apply Gamma
    v = Math.pow(v, 1 / gamma);
    // Apply Contrast
    v = (v - 0.5) * contrast + 0.5;
    // Apply Intensity
    v = v * intensity;
    // Clamp
    v = Math.min(1, Math.max(0, v));
    // Apply Invert
    if (invert) v = 1 - v;
    
    data[i] = data[i+1] = data[i+2] = v * 255;
  };

  if (map.id === 'normal') {
    const strength = intensity * 2;
    const output = ctx.createImageData(size, size);
    const dst = output.data;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = (y * size + x) * 4;
        const getGray = (ox: number, oy: number) => {
          const px = Math.min(size - 1, Math.max(0, x + ox));
          const py = Math.min(size - 1, Math.max(0, y + oy));
          const i = (py * size + px) * 4;
          return (data[i] * 0.3 + data[i+1] * 0.59 + data[i+2] * 0.11) / 255.0;
        };
        const tl = getGray(-1, -1); const t = getGray(0, -1); const tr = getGray(1, -1);
        const l = getGray(-1, 0); const r = getGray(1, 0);
        const bl = getGray(-1, 1); const b = getGray(0, 1); const br = getGray(1, 1);
        const dx = (tr + 2.0 * r + br) - (tl + 2.0 * l + bl);
        const dy = (bl + 2.0 * b + br) - (tl + 2.0 * t + tr);
        const dz = 1.0 / strength;
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        dst[idx] = (dx / len * 0.5 + 0.5) * 255;
        dst[idx+1] = (dy / len * 0.5 + 0.5) * 255;
        dst[idx+2] = (dz / len * 0.5 + 0.5) * 255;
        dst[idx+3] = 255;
        if (invert) {
            dst[idx] = 255 - dst[idx];
            dst[idx + 1] = 255 - dst[idx + 1];
        }
      }
    }
    ctx.putImageData(output, 0, 0);
  } else if (map.id === 'original' || map.id === 'albedo') {
     for (let i = 0; i < data.length; i += 4) {
       for(let j=0; j<3; j++) {
         let v = data[i+j] / 255;
         v = Math.pow(v, 1/gamma);
         v = (v - 0.5) * contrast + 0.5;
         data[i+j] = Math.min(255, Math.max(0, v * 255));
       }
     }
     ctx.putImageData(imageData, 0, 0);
  } else {
    for (let i = 0; i < data.length; i += 4) {
      const gray = (data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11);
      applyPixel(i, gray);
    }
    ctx.putImageData(imageData, 0, 0);
  }

  return canvas.toDataURL('image/png');
};

// --- Components ---

export default function App() {
  const [sourceImage, setSourceImage] = useState<string | null>(null);
  const [maps, setMaps] = useState<TextureMap[]>(INITIAL_MAPS);
  const [selectedMapId, setSelectedMapId] = useState<MapType>('original');
  const [isGenerating, setIsGenerating] = useState(false);
  const [resolution, setResolution] = useState<'1024' | '2048' | '4096'>('4096');
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  
  const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
  const selectedMap = maps.find(m => m.id === selectedMapId)!;
  const sourceRef = useRef<HTMLImageElement | null>(null);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const result = e.target?.result as string;
        setSourceImage(result);
        const img = new Image();
        img.src = result;
        img.onload = () => { sourceRef.current = img; };
        
        setMaps(INITIAL_MAPS.map(m => ({ ...m, status: 'idle', url: undefined })));
        
        try {
          const resultAi = await genAI.models.generateContent({
             model: 'gemini-3-flash-preview',
             contents: [
               { text: "Identify this texture material (e.g. Marble, Wood, Stone) and provide technical PBR advice in Arabic. Be very concise." },
               { inlineData: { data: result.split(',')[1], mimeType: file.type } }
             ]
          });
          setAiAnalysis(resultAi.text || null);
        } catch {}
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': [] },
    multiple: false
  } as any);

  const handleUpdateSettings = (id: MapType, settings: Partial<MapSettings>) => {
    setMaps(prev => prev.map(m => m.id === id ? { ...m, settings: { ...m.settings, ...settings }, status: 'idle' } : m));
  };

  const processSelected = async () => {
    if (!sourceRef.current) return;
    setIsGenerating(true);
    setMaps(prev => prev.map(m => m.id === selectedMapId ? { ...m, status: 'generating' } : m));
    
    await new Promise(resolve => setTimeout(resolve, 500));
    const url = generateMap(sourceRef.current, selectedMap, resolution);
    
    setMaps(prev => prev.map(m => m.id === selectedMapId ? { ...m, status: 'done', url } : m));
    setIsGenerating(false);
  };

  const generateAll = async () => {
    if (!sourceRef.current) return;
    setIsGenerating(true);
    for (const map of maps) {
       setMaps(prev => prev.map(m => m.id === map.id ? { ...m, status: 'generating' } : m));
       await new Promise(resolve => setTimeout(resolve, 300));
       const url = generateMap(sourceRef.current, map, resolution);
       setMaps(prev => prev.map(m => m.id === map.id ? { ...m, status: 'done', url } : m));
    }
    setIsGenerating(false);
  };

  const reset = () => {
    setSourceImage(null);
    setMaps(INITIAL_MAPS);
    setAiAnalysis(null);
    sourceRef.current = null;
  };

  return (
    <div className="h-screen flex bg-surface-dark text-text-primary overflow-hidden font-sans">
      <aside className="w-72 bg-surface-sidebar border-r border-border-subtle flex flex-col">
        <div className="p-6 border-b border-border-subtle text-right">
          <div className="flex items-center justify-end gap-3 mb-1">
             <h1 className="text-xl font-bold tracking-tight">المدة PBR LAB</h1>
             <div className="w-8 h-8 bg-brand rounded-lg flex items-center justify-center">
                <Box className="w-5 h-5 text-white" />
             </div>
          </div>
          <p className="text-[10px] text-text-muted font-bold tracking-widest">TEXTURE GENERATOR</p>
        </div>

        <div className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
           <p className="text-[10px] font-bold text-text-muted px-3 mb-2 uppercase tracking-widest text-right">قائمة الخرائط</p>
           {maps.map((map) => (
             <button
              key={map.id}
              onClick={() => setSelectedMapId(map.id)}
              className={cn(
                "w-full flex items-center justify-end gap-3 p-3 rounded-xl transition-all group relative text-right",
                selectedMapId === map.id ? "nav-item-active" : "text-text-secondary hover:bg-white/5"
              )}
             >
                <div className="flex-1">
                  <p className="text-xs font-bold">{map.nameAr}</p>
                  <p className="text-[10px] opacity-60 font-mono">{map.name}</p>
                </div>
                <div className={cn(
                  "w-2 h-2 rounded-full",
                  map.status === 'done' ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-white/10"
                )} />
             </button>
           ))}
        </div>

        <div className="p-6 border-t border-border-subtle space-y-4">
           {sourceImage && (
             <button
               onClick={generateAll}
               disabled={isGenerating}
               className="w-full py-3 bg-brand text-white rounded-xl text-xs font-bold shadow-lg shadow-brand/20 hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-2"
             >
               {isGenerating ? <Cpu className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
               توليد الكل (Auto-PBR)
             </button>
           )}
           <div className="flex items-center justify-between">
              <button onClick={reset} className="p-2 text-text-muted hover:text-white transition-colors">
                <Trash2 className="w-4 h-4" />
              </button>
              <p className="text-[10px] font-mono text-text-muted">BUILD v1.0.8</p>
           </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col bg-surface-dark p-8 overflow-hidden">
         <header className="flex items-center justify-between mb-8 text-right">
            <div className="flex items-center gap-4">
               <div className="flex bg-surface-sidebar border border-border-subtle p-1 rounded-lg">
                {(['1024', '2048', '4096'] as const).map((res) => (
                  <button key={res} onClick={() => setResolution(res)} className={cn("px-4 py-1.5 rounded-md text-[10px] font-bold transition-all", resolution === res ? "bg-border-subtle text-white" : "text-text-muted hover:text-text-secondary")}>{res}px</button>
                ))}
              </div>
            </div>
            <div>
               <h2 className="text-3xl font-bold text-white tracking-tight">{selectedMap.nameAr}</h2>
               <p className="text-text-secondary text-sm">{selectedMap.description}</p>
            </div>
         </header>

         <div className="flex-1 relative flex items-center justify-center bg-surface-sidebar rounded-3xl border border-white/5 overflow-hidden shadow-2xl">
            <AnimatePresence mode="wait">
              {!sourceImage ? (
                <motion.div 
                  key="empty"
                  {...getRootProps()}
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="w-full h-full flex flex-col items-center justify-center cursor-pointer hover:bg-white/5 transition-colors group"
                >
                   <input {...getInputProps()} />
                   <div className="w-20 h-20 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-6 group-hover:scale-110 group-hover:border-brand/40 transition-all">
                      <Upload className="w-8 h-8 text-text-muted group-hover:text-brand" />
                   </div>
                   <h3 className="text-lg font-bold text-white mb-2">ارفع خامتك هنا</h3>
                   <p className="text-text-secondary text-sm">PNG, JPG, TIFF (Up to 4K Supported)</p>
                </motion.div>
              ) : (
                <motion.div 
                  key={selectedMapId + (selectedMap.url || '')}
                  initial={{ opacity: 0, scale: 1.02 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="w-full h-full flex items-center justify-center p-12"
                >
                   {selectedMap.url ? (
                     <div className="relative group max-h-full aspect-square">
                        <img 
                          src={selectedMap.url} 
                          className="max-w-full max-h-full object-contain rounded-lg shadow-2xl border border-white/10" 
                          alt={selectedMap.name} 
                        />
                        <div className="absolute top-4 right-4 flex gap-2">
                           <button onClick={(e) => { e.stopPropagation(); const a=document.createElement('a');a.href=selectedMap.url!;a.download=`${selectedMap.id}.png`;a.click(); }} className="p-3 bg-brand text-white rounded-xl shadow-xl hover:scale-110 active:scale-95 transition-all">
                             <Download className="w-5 h-5" />
                           </button>
                        </div>
                     </div>
                   ) : (
                     <div className="flex flex-col items-center justify-center gap-6">
                        <div className="w-32 h-32 relative">
                           <div className="absolute inset-0 border-4 border-brand/20 rounded-full" />
                           <motion.div 
                             className="absolute inset-0 border-4 border-brand border-t-transparent rounded-full"
                             animate={{ rotate: 360 }}
                             transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                           />
                        </div>
                        <p className="text-text-secondary font-mono text-sm tracking-widest animate-pulse">AWAITING GENERATION...</p>
                        <button onClick={processSelected} className="px-8 py-3 bg-white text-black font-bold rounded-xl hover:bg-gray-200 transition-all">بدء المعالجة</button>
                     </div>
                   )}
                </motion.div>
              )}
            </AnimatePresence>
            
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 glass p-2 rounded-2xl">
               <button className="p-2 text-text-muted hover:text-white"><Maximize2 className="w-4 h-4" /></button>
               <div className="w-px h-4 bg-white/10 mx-1" />
               <button className="p-2 text-text-muted hover:text-white"><Grid3X3 className="w-4 h-4" /></button>
            </div>
         </div>
      </main>

      {sourceImage && (
        <aside className="w-80 bg-surface-sidebar border-l border-border-subtle flex flex-col">
          <div className="p-6 border-b border-border-subtle text-right">
             <h3 className="text-xs font-bold text-text-muted tracking-widest uppercase">تعديل الخصائص</h3>
          </div>
          
          <div className="flex-1 overflow-y-auto p-6 space-y-8">
             <div className="space-y-6">
                <div className="space-y-3">
                   <div className="flex items-center justify-between text-[11px] font-mono">
                      <span className="text-brand font-bold">{selectedMap.settings.intensity.toFixed(2)}</span>
                      <span className="text-text-muted uppercase">Intensity / القوة</span>
                   </div>
                   <input 
                     type="range" min="0" max="5" step="0.1"
                     value={selectedMap.settings.intensity}
                     onChange={(e) => handleUpdateSettings(selectedMapId, { intensity: parseFloat(e.target.value) })}
                     className="control-slider"
                   />
                </div>

                <div className="space-y-3">
                   <div className="flex items-center justify-between text-[11px] font-mono">
                      <span className="text-brand font-bold">{selectedMap.settings.contrast.toFixed(2)}</span>
                      <span className="text-text-muted uppercase">Contrast / التباين</span>
                   </div>
                   <input 
                     type="range" min="0" max="3" step="0.1"
                     value={selectedMap.settings.contrast}
                     onChange={(e) => handleUpdateSettings(selectedMapId, { contrast: parseFloat(e.target.value) })}
                     className="control-slider"
                   />
                </div>

                <div className="space-y-3">
                   <div className="flex items-center justify-between text-[11px] font-mono">
                      <span className="text-brand font-bold">{selectedMap.settings.gamma.toFixed(2)}</span>
                      <span className="text-text-muted uppercase">Gamma / جاما</span>
                   </div>
                   <input 
                     type="range" min="0.2" max="3" step="0.1"
                     value={selectedMap.settings.gamma}
                     onChange={(e) => handleUpdateSettings(selectedMapId, { gamma: parseFloat(e.target.value) })}
                     className="control-slider"
                   />
                </div>

                <div className="pt-4 border-t border-white/5 space-y-4">
                   <button 
                     onClick={() => handleUpdateSettings(selectedMapId, { invert: !selectedMap.settings.invert })}
                     className={cn(
                       "w-full py-3 rounded-xl border flex items-center justify-center gap-2 text-[11px] font-bold transition-all",
                       selectedMap.settings.invert ? "bg-brand/10 border-brand text-brand" : "border-white/5 text-text-muted"
                     )}
                   >
                     {selectedMap.settings.invert ? <CheckCircle2 className="w-4 h-4" /> : <RefreshCw className="w-4 h-4" />}
                     INVERT MAP / عكس الخريطة
                   </button>
                   
                   <button 
                     onClick={processSelected}
                     className="w-full py-4 bg-white text-black rounded-xl text-xs font-bold hover:bg-gray-200 transition-all flex items-center justify-center gap-2"
                   >
                     <RefreshCw className={cn("w-4 h-4", isGenerating && "animate-spin")} />
                     تطبيق التعديلات
                   </button>
                </div>
             </div>

             {aiAnalysis && (
               <div className="bg-brand/5 border border-brand/20 p-4 rounded-2xl text-right">
                  <div className="flex items-center justify-end gap-2 mb-2">
                     <span className="text-[10px] font-bold text-brand uppercase">نصيحة الذكاء الصناعي</span>
                     <AlertCircle className="w-3 h-3 text-brand" />
                  </div>
                  <p className="text-[11px] text-text-primary leading-relaxed">
                    {aiAnalysis}
                  </p>
               </div>
             )}
          </div>
          
          <div className="p-6 border-t border-border-subtle">
             <div className="flex items-center justify-between mb-4">
                <span className="text-[10px] font-bold text-text-muted text-right">PBR WORKFLOW</span>
                <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-500 text-[9px] font-bold">READY</span>
             </div>
             <p className="text-[10px] text-text-muted leading-relaxed text-right italic">
               تم ضبط الإعدادات لتتوافق مع محركات الرندر العالمية مثل V-Ray, Corona, and Unreal Engine.
             </p>
          </div>
        </aside>
      )}
    </div>
  );
}

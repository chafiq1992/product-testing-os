"use client"

import { type SocialAgentConfig, type SocialAgentStage } from '@/lib/api'

const stages: {id: SocialAgentStage; title: string; description: string}[] = [
  {id:'analyzer', title:'1. Product analyzer', description:'Reads catalog facts and reference photos. Astra with medium reasoning creates the shared product brief.'},
  {id:'copy', title:'2. Post text generation', description:'Turns the shared brief into warm, concise Arabic copy. Luna keeps this focused writing step economical.'},
  {id:'image_prompt', title:'3. Image prompt specialist', description:'Astra designs a product-relevant visual surprise: clean composition, gentle humor and a clear reason to stop scrolling.'},
  {id:'reviewer', title:'5. Independent reviewer', description:'Checks the finished image and caption against the source product. Fidelity and factuality checks remain mandatory.'},
  {id:'learning', title:'6. Performance analyst', description:'Uses measured reach, engagement and clicks to suggest the next controlled experiment.'},
]
const models = ['gpt-6-astra','gpt-5.6-sol','gpt-5.6-terra','gpt-5.6-luna']
const input = 'mt-2 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal text-slate-900'
const label = 'text-sm font-medium text-slate-700'

export default function AgentSettings({config, onChange, disabled}: {
  config: SocialAgentConfig; onChange: (config: SocialAgentConfig)=>void; disabled: boolean
}) {
  function set<K extends keyof SocialAgentConfig>(key:K, value:SocialAgentConfig[K]) { onChange({...config,[key]:value}) }
  function stageCard(stage: typeof stages[number]) {
    const {id,title,description}=stage
    return <section key={id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-lg font-bold text-slate-950">{title}</h3><p className="mt-1 max-w-3xl text-sm text-slate-500">{description}</p>
      <div className="mt-5 grid gap-4 md:grid-cols-3">
        <label className={label}>Model<select className={input} value={config[`${id}_model`]} onChange={e=>set(`${id}_model`,e.target.value)}>{models.map(model=><option key={model}>{model}</option>)}</select></label>
        <label className={label}>Reasoning<select className={input} value={config[`${id}_reasoning`]} onChange={e=>set(`${id}_reasoning`,e.target.value as 'low'|'medium'|'high')}><option value="low">Low · economical</option><option value="medium">Medium · balanced</option><option value="high">High · more reasoning</option></select></label>
        <label className={label}>Output token limit<input className={input} type="number" min={1500} max={12000} step={100} value={config[`${id}_max_output_tokens`]} onChange={e=>set(`${id}_max_output_tokens`,Number(e.target.value))}/><span className="mt-1 block text-xs font-normal text-slate-400">Includes reasoning tokens. Too low can prevent completion.</span></label>
      </div>
      <label className={`${label} mt-5 block`}>Instructions<textarea className={`${input} min-h-40 leading-6`} maxLength={8000} value={config[`${id}_instructions`]} onChange={e=>set(`${id}_instructions`,e.target.value)}/></label>
    </section>
  }
  return <fieldset disabled={disabled} className="space-y-5 disabled:opacity-60">
    <div className="rounded-2xl border border-fuchsia-200 bg-fuchsia-50 p-5"><h2 className="text-xl font-bold text-slate-950">Creative team settings</h2><p className="mt-2 text-sm leading-6 text-slate-600">Settings are saved for this store and apply to new generation attempts. Product analysis → caption → image prompt → image → independent review. Save changes using the button below.</p></div>
    {stages.slice(0,3).map(stageCard)}
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-lg font-bold text-slate-950">4. Image generation</h3><p className="mt-1 text-sm text-slate-500">Flare designs the complete post from your product reference: integrated product, bold Arabic typography and a relevant visual surprise. Medium quality balances detail and cost. Every result is reviewed for product accuracy and text quality.</p>
      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <label className={label}>Provider<select className={input} value={config.image_provider} onChange={e=>set('image_provider',e.target.value as 'openai'|'gemini')}><option value="openai">OpenAI</option><option value="gemini">Gemini Nano Banana</option></select></label>
        {config.image_provider==='openai'?<>
          <label className={label}>Image model<select className={input} value={config.openai_image_model} onChange={e=>set('openai_image_model',e.target.value)}><option value="gpt-image-2.5-flare">GPT Image 2.5 Flare</option><option value="gpt-image-2.5-flare-2026-09-08">Flare · snapshot Sep 8, 2026</option><option value="gpt-image-2">GPT Image 2</option></select></label>
          <label className={label}>Generation quality<select className={input} value={config.image_quality} onChange={e=>set('image_quality',e.target.value as SocialAgentConfig['image_quality'])}><option value="low">Low · lowest cost</option><option value="medium">Medium · recommended</option><option value="high">High · more detail</option></select></label>
          <label className={label}>Correction model<select className={input} value={config.image_repair_model||'same'} onChange={e=>set('image_repair_model',e.target.value as SocialAgentConfig['image_repair_model'])}><option value="same">Same as generation model</option><option value="gpt-image-2.5-sunburst">GPT Image 2.5 Sunburst · precise edits</option></select><span className="mt-1 block text-xs font-normal normal-case text-slate-500">OpenAI corrections only. First generations keep the main image model.</span></label>
          <label className={label}>Correction quality<select className={input} value={config.image_repair_quality||'medium'} onChange={e=>set('image_repair_quality',e.target.value as SocialAgentConfig['image_repair_quality'])}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High · higher cost</option></select><span className="mt-1 block text-xs font-normal normal-case text-slate-500">Only used when a failed image needs correction. Consumes a remaining review attempt.</span></label>
          <label className={label}>Generation size<select className={input} value={config.image_size} onChange={e=>set('image_size',e.target.value as SocialAgentConfig['image_size'])}><option value="1024x1024">1024 × 1024 · padded to 4:5</option><option value="1024x1280">1024 × 1280 · native 4:5</option><option value="1024x1536">1024 × 1536 · padded to 4:5</option></select></label>
        </>:<label className={label}>Gemini model<select className={input} value={config.gemini_image_model} onChange={e=>set('gemini_image_model',e.target.value as SocialAgentConfig['gemini_image_model'])}><option value="gemini-3.1-flash-image">Nano Banana 2</option><option value="gemini-3.1-flash-lite-image">Nano Banana 2 Lite</option><option value="gemini-3-pro-image">Nano Banana Pro</option></select></label>}
      </div>
      <div className="mt-5 rounded-xl border border-fuchsia-100 bg-fuchsia-50/50 p-4">
        <h4 className="font-semibold text-slate-950">Arabic text and overlays</h4><p className="mt-1 text-sm text-slate-500">A short headline, one benefit, and an optional offer badge. The copywriter prepares the words; the image specialist designs their placement.</p>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <label className={label}>On-image text<select className={input} value={config.image_text_mode} onChange={e=>set('image_text_mode',e.target.value as SocialAgentConfig['image_text_mode'])}><option value="headline_benefit">Headline + benefit</option><option value="headline">Headline only</option><option value="none">No text or overlays</option></select></label>
          <label className={label}>Offer badge<select className={input} disabled={config.image_text_mode==='none'} value={config.image_badge_mode} onChange={e=>set('image_badge_mode',e.target.value as SocialAgentConfig['image_badge_mode'])}><option value="price">Actual product price</option><option value="discount">Verified discount only</option><option value="none">No offer badge</option></select><span className="mt-1 block text-xs text-slate-400">Omitted when catalog evidence is missing.</span></label>
          <label className={label}>Short Arabic CTA<input className={input} dir="rtl" lang="ar" maxLength={24} disabled={config.image_text_mode==='none'} value={config.image_cta_ar} onChange={e=>set('image_cta_ar',e.target.value)}/><span className="mt-1 block text-xs text-slate-400">Leave blank to omit the CTA.</span></label>
        </div>
      </div>
      <label className={`${label} mt-5 block`}>Image renderer instructions<textarea className={`${input} min-h-28 leading-6`} maxLength={8000} value={config.image_instructions} onChange={e=>set('image_instructions',e.target.value)}/></label>
    </section>
    {stages.slice(3).map(stageCard)}
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-lg font-bold text-slate-950">Inputs, outputs and cost controls</h3>
      <p className="mt-1 text-sm text-slate-500">One shared analysis per attempt; no automatic model upgrades. Provider requests retry transient failures once. More candidates and rejection attempts increase spend. Token limits are per call, not a total budget.</p>
      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <label className={label}>Image candidates per post<input type="number" min={1} max={3} className={input} value={config.creative_variants} onChange={e=>set('creative_variants',Number(e.target.value))}/><span className="mt-1 block text-xs text-slate-400">1 minimizes image and review calls.</span></label>
        <label className={label}>Reference photos<input type="number" min={1} max={3} className={input} value={config.source_image_limit} onChange={e=>set('source_image_limit',Number(e.target.value))}/></label>
        <label className={label}>Maximum caption characters<input type="number" min={200} max={1800} className={input} value={config.caption_max_chars} onChange={e=>set('caption_max_chars',Number(e.target.value))}/></label>
        <label className={label}>Analytics lookback days<input type="number" min={7} max={90} className={input} value={config.analytics_lookback_days} onChange={e=>set('analytics_lookback_days',Number(e.target.value))}/></label>
      </div>
      <label className={`${label} mt-5 block`}>Default hashtags<textarea className={input} value={config.hashtags.join(' ')} onChange={e=>set('hashtags',e.target.value.split(/\s+/))} dir="rtl" lang="ar"/></label>
      <label className={`${label} mt-5 block`}>Shared cost and efficiency instructions<textarea className={`${input} min-h-28 leading-6`} maxLength={8000} value={config.cost_instructions} onChange={e=>set('cost_instructions',e.target.value)}/></label>
      <p className="mt-3 text-xs text-slate-500">Customer copy: Modern Standard Arabic for Morocco. Internal analysis: English. Final output: PNG, 4:5, with your selected overlays. Image editing includes one product-reference input. Models require access through the server&apos;s OpenAI account.</p>
    </section>
  </fieldset>
}

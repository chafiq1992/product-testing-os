import dynamic from 'next/dynamic'

const AdsAgentClient = dynamic(()=>import('./AdsAgentClient'), { ssr: false })

export default function AdsAgentPage(){
  return <AdsAgentClient/>
}



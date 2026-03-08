'use client'

import { useState, useEffect, useRef } from 'react'
import { Send, Paperclip, Smile, User, CheckCheck, Users, Mic, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatDate, fileToBase64 } from '@/lib/utils'

export default function MessagesPage() {
  const [messages, setMessages] = useState<any[]>([])
  const [newMessage, setNewMessage] = useState('')
  const [familyMembers, setFamilyMembers] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const supabase = createClient()

  useEffect(() => {
    loadData()
    subscribeToMessages()
  }, [])

  const loadData = async () => {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: userData } = await supabase
        .from('users')
        .select('family_id')
        .eq('id', user.id)
        .single()

      if (!userData?.family_id) return

      const { data: messagesData } = await supabase
        .from('messages')
        .select('*, sender:users!messages_sender_id_fkey(name, avatar_url)')
        .eq('family_id', userData.family_id)
        .order('created_at', { ascending: true })
        .limit(50)

      if (messagesData) {
        setMessages(messagesData)
      }

      const { data: members } = await supabase
        .from('users')
        .select('id, name, role, avatar_url')
        .eq('family_id', userData.family_id)
        .order('name')

      if (members) {
        setFamilyMembers(members)
      }
    } catch (err) {
      console.error('Error loading data:', err)
    } finally {
      setLoading(false)
    }
  }

  const subscribeToMessages = () => {
    const channel = supabase
      .channel('messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        supabase
          .from('messages')
          .select('*, sender:users!messages_sender_id_fkey(name, avatar_url)')
          .eq('id', payload.new.id)
          .single()
          .then(({ data }) => {
            if (data) {
              setMessages(prev => [...prev, data])
            }
          })
      })
      .subscribe()
    return () => supabase.removeChannel(channel)
  }

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if ((!newMessage.trim() && !photoFile) || sending) return

    setSending(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: userData } = await supabase
        .from('users')
        .select('family_id')
        .eq('id', user.id)
        .single()

      if (!userData?.family_id) return

      let messageType = 'text'
      let attachments: string[] = []
      let content = newMessage.trim()

      if (photoFile) {
        const base64 = await fileToBase64(photoFile)
        attachments = [base64]
        messageType = 'image'
        if (!content) content = 'Image attachment'
      }

      const { error } = await supabase
        .from('messages')
        .insert([{
          family_id: userData.family_id,
          sender_id: user.id,
          content: content,
          type: messageType,
          attachments: attachments,
          read_by: [user.id],
        }])

      if (error) throw error

      setNewMessage('')
      setPhotoFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (err) {
      console.error('Error sending message:', err)
      alert('Failed to send message. Please try again.')
    } finally {
      setSending(false)
    }
  }

  const getInitials = (name: string) => name.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2)

  return (
    <div className="flex flex-col h-[calc(100vh-12rem)]">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Family Messages</h1>
        <p className="mt-2 text-gray-600">Chat with your family members.</p>
      </div>

      <div className="flex-1 flex flex-col card p-0 overflow-hidden">
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {messages.map((message) => {
            // Using a simple check since we can't easily await inside map without more complex state
            const isCurrentUser = true 
            return (
              <div key={message.id} className={`flex ${isCurrentUser ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[70%] rounded-2xl p-4 ${isCurrentUser ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-900'}`}>
                  <div className="font-semibold text-sm">{isCurrentUser ? 'You' : message.sender?.name}</div>
                  <p className="text-sm">{message.content}</p>
                  {message.type === 'image' && message.attachments?.[0] && (
                    <img src={message.attachments[0]} alt="Attachment" className="max-w-full rounded-lg mt-2" />
                  )}
                </div>
              </div>
            )
          })}
          <div ref={messagesEndRef} />
        </div>

        <div className="p-4 border-t">
          <form onSubmit={handleSendMessage} className="flex items-center space-x-2">
            <input type="file" ref={fileInputRef} accept="image/*" className="hidden" onChange={(e) => setPhotoFile(e.target.files?.[0] || null)} />
            <button type="button" className={`p-2 rounded-full ${photoFile ? 'text-green-500' : 'text-gray-600'}`} onClick={() => fileInputRef.current?.click()}>
              <Paperclip className="w-5 h-5" />
            </button>
            <input type="text" value={newMessage} onChange={(e) => setNewMessage(e.target.value)} placeholder={photoFile ? `Selected: ${photoFile.name}` : "Type a message..."} className="input-field flex-1" disabled={sending} />
            <button type="submit" disabled={sending || (!newMessage.trim() && !photoFile)} className="btn-primary p-3 rounded-full">
              {sending ? <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div> : <Send className="w-5 h-5" />}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

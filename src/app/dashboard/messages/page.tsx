'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Send, Paperclip, Smile, User, CheckCheck, Users } from 'lucide-react'
import { formatDate } from '@/lib/utils'

export default function MessagesPage() {
  const [messages, setMessages] = useState<any[]>([])
  const [newMessage, setNewMessage] = useState('')
  const [familyMembers, setFamilyMembers] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [hasMarkedRead, setHasMarkedRead] = useState(false)

  // Mark messages as read on initial load
  useEffect(() => {
    if (currentUserId && messages.length > 0 && !hasMarkedRead) {
      fetch('/api/messages', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markAll: true }),
      }).catch(() => {/* silent fail */})
      setHasMarkedRead(true)
    }
  }, [currentUserId, messages.length, hasMarkedRead])

  // Load messages and family members
  useEffect(() => {
    loadData()

    // Poll for new messages every 5 seconds
    pollIntervalRef.current = setInterval(loadData, 5000)

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
      }
    }
  }, [])

  const loadData = async () => {
    try {
      const res = await fetch('/api/messages')
      const data = await res.json()

      if (res.ok) {
        if (data.messages) setMessages(data.messages)
        if (data.members) setFamilyMembers(data.members)
        if (data.userId) setCurrentUserId(data.userId)
      }
    } catch (err) {
      console.error('Error loading data:', err)
    } finally {
      setLoading(false)
    }
  }

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newMessage.trim() || sending) return

    setSending(true)
    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newMessage.trim(), type: 'text' }),
      })
      const data = await res.json()

      if (!res.ok) throw new Error(data.error || 'Failed to send message')

      // Add the new message to the list immediately
      if (data.message) {
        setMessages(prev => [...prev, data.message])
      }

      setNewMessage('')
    } catch (err) {
      console.error('Error sending message:', err)
      alert('Failed to send message. Please try again.')
    } finally {
      setSending(false)
    }
  }

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(part => part[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  return (
    <div className="flex flex-col h-[calc(100vh-12rem)]">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Family Messages</h1>
        <p className="mt-2 text-gray-600">
          Chat with your family members and share important announcements.
        </p>
      </div>

      <div className="flex-1 flex flex-col card p-0 overflow-hidden">
        {/* Family members sidebar (desktop) */}
        <div className="hidden md:flex border-b">
          <div className="p-4 border-r w-64">
            <h3 className="font-semibold text-gray-900 mb-4">Family Members</h3>
            <div className="space-y-3">
              {familyMembers.map((member) => (
                <div key={member.id} className="flex items-center">
                  <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-semibold text-sm mr-3">
                    {getInitials(member.name)}
                  </div>
                  <div>
                    <div className="font-medium text-gray-900">{member.name}</div>
                    <div className="text-xs text-gray-500 capitalize">{member.role}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Messages area */}
          <div className="flex-1 flex flex-col">
            {/* Messages header */}
            <div className="p-4 border-b">
              <div className="flex items-center">
                <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-semibold mr-3">
                  <Users className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="font-semibold text-gray-900">Family Chat</h2>
                  <p className="text-sm text-gray-600">
                    {familyMembers.length} family members
                  </p>
                </div>
              </div>
            </div>

            {/* Messages container */}
            <div className="flex-1 overflow-y-auto p-4 space-y-6">
              {loading ? (
                <div className="text-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                  <p className="mt-4 text-gray-600">Loading messages...</p>
                </div>
              ) : messages.length === 0 ? (
                <div className="text-center py-12">
                  <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Send className="w-8 h-8 text-gray-400" />
                  </div>
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No messages yet</h3>
                  <p className="text-gray-600 mb-6">
                    Start the conversation by sending a message to your family.
                  </p>
                </div>
              ) : (
                messages.map((message) => {
                  const isCurrentUser = message.sender_id === currentUserId
                  return (
                    <div
                      key={message.id}
                      className={`flex ${isCurrentUser ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[70%] rounded-2xl p-4 ${
                          isCurrentUser
                            ? 'bg-blue-600 text-white rounded-br-none'
                            : 'bg-gray-100 text-gray-900 rounded-bl-none'
                        }`}
                      >
                        <div className="flex items-center mb-2">
                          <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-semibold text-xs mr-2">
                            {getInitials(message.sender?.name || 'U')}
                          </div>
                          <div className="font-medium">
                            {isCurrentUser ? 'You' : message.sender?.name}
                          </div>
                          <div className={`text-xs ml-3 ${isCurrentUser ? 'text-blue-200' : 'text-gray-500'}`}>
                            {formatDate(message.created_at)}
                          </div>
                        </div>
                        <p>{message.content}</p>
                        <div className="flex items-center justify-between mt-3">
                          <div className="text-xs opacity-75">
                            {message.type === 'announcement' && '📢 Announcement'}
                          </div>
                          {isCurrentUser && (
                            <div className="flex items-center text-xs">
                              <CheckCheck className="w-3 h-3 mr-1" />
                              {message.read_by?.length > 1 ? 'Read' : 'Sent'}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Message input */}
            <div className="p-4 border-t">
              <form onSubmit={handleSendMessage} className="flex items-center space-x-4">
                <button
                  type="button"
                  className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-full"
                >
                  <Paperclip className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-full"
                >
                  <Smile className="w-5 h-5" />
                </button>
                <input
                  type="text"
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder="Type a message..."
                  className="input-field flex-1"
                  disabled={sending}
                />
                <button
                  type="submit"
                  disabled={sending || !newMessage.trim()}
                  className="btn-primary p-3 rounded-full"
                >
                  <Send className="w-5 h-5" />
                </button>
              </form>
            </div>
          </div>
        </div>

        {/* Mobile view */}
        <div className="md:hidden flex-1 flex flex-col">
          {/* Messages header */}
          <div className="p-4 border-b">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-semibold mr-3">
                  <Users className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="font-semibold text-gray-900">Family Chat</h2>
                  <p className="text-sm text-gray-600">
                    {familyMembers.length} family members
                  </p>
                </div>
              </div>
              <button className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md">
                <User className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Messages container */}
          <div className="flex-1 overflow-y-auto p-4 space-y-6">
            {loading ? (
              <div className="text-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                <p className="mt-4 text-gray-600">Loading messages...</p>
              </div>
            ) : messages.length === 0 ? (
              <div className="text-center py-12">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Send className="w-8 h-8 text-gray-400" />
                </div>
                <h3 className="text-lg font-medium text-gray-900 mb-2">No messages yet</h3>
                <p className="text-gray-600 mb-6">
                  Start the conversation by sending a message to your family.
                </p>
              </div>
            ) : (
              messages.map((message) => {
                const isCurrentUser = message.sender_id === currentUserId
                return (
                  <div
                    key={message.id}
                    className={`flex ${isCurrentUser ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl p-3 ${
                        isCurrentUser
                          ? 'bg-blue-600 text-white rounded-br-none'
                          : 'bg-gray-100 text-gray-900 rounded-bl-none'
                      }`}
                    >
                      <div className="flex items-center mb-1">
                        <div className="font-medium text-sm">
                          {isCurrentUser ? 'You' : message.sender?.name}
                        </div>
                        <div className={`text-xs ml-2 ${isCurrentUser ? 'text-blue-200' : 'text-gray-500'}`}>
                          {formatDate(message.created_at)}
                        </div>
                      </div>
                      <p className="text-sm">{message.content}</p>
                    </div>
                  </div>
                )
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Message input */}
          <div className="p-4 border-t">
            <form onSubmit={handleSendMessage} className="flex items-center space-x-2">
              <button
                type="button"
                className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-full"
              >
                <Paperclip className="w-5 h-5" />
              </button>
              <input
                type="text"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                placeholder="Type a message..."
                className="input-field flex-1"
                disabled={sending}
              />
              <button
                type="submit"
                disabled={sending || !newMessage.trim()}
                className="btn-primary p-3 rounded-full"
              >
                <Send className="w-5 h-5" />
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* Tips */}
      <div className="mt-8 bg-gradient-to-r from-purple-50 to-pink-50 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Messaging Tips</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <h4 className="font-medium text-gray-900 mb-2">Announcements</h4>
            <p className="text-sm text-gray-600">
              Use the announcement feature for important family news that everyone needs to see.
            </p>
          </div>
          <div>
            <h4 className="font-medium text-gray-900 mb-2">Photo Sharing</h4>
            <p className="text-sm text-gray-600">
              Share photos from family events or daily moments (coming soon).
            </p>
          </div>
          <div>
            <h4 className="font-medium text-gray-900 mb-2">Voice Messages</h4>
            <p className="text-sm text-gray-600">
              Send quick voice messages for younger children (coming soon).
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

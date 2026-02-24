# Family Planner - Deployment Guide

## 🚀 **Deploy to Production**

### **Option 1: Vercel (Recommended)**
1. **Push to GitHub**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin <your-github-repo-url>
   git push -u origin main
   ```

2. **Deploy to Vercel**
   - Go to [vercel.com](https://vercel.com)
   - Import your GitHub repository
   - Add environment variables:
     - `NEXT_PUBLIC_SUPABASE_URL`
     - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
     - `SUPABASE_SERVICE_ROLE_KEY` (optional, for admin functions)
   - Deploy!

3. **Set up custom domain** (optional)
   - In Vercel project settings → Domains
   - Add your custom domain
   - Follow DNS configuration instructions

### **Option 2: Railway**
1. **Create Railway account**
2. **Create new project from GitHub**
3. **Add environment variables**
4. **Deploy with one click**

### **Option 3: Docker (Self-hosted)**
```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
```

## 🗄️ **Database Setup**

### **1. Create Supabase Project**
1. Go to [supabase.com](https://supabase.com)
2. Click "New Project"
3. Choose region closest to your users
4. Set password (save it securely)
5. Wait for project to initialize (2-3 minutes)

### **2. Configure Database**
1. In Supabase dashboard, go to **SQL Editor**
2. Copy contents of `database/setup.sql`
3. Run the SQL script
4. (Optional) Run `database/updates.sql`

### **3. Set up Authentication**
1. Go to **Authentication → Settings**
2. Enable "Email auth provider"
3. Configure email templates if needed
4. Add site URL (your deployed app URL)

### **4. Get API Keys**
1. Go to **Settings → API**
2. Copy:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon/public key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role key** → `SUPABASE_SERVICE_ROLE_KEY` (keep secret!)

## 🔧 **Environment Variables**

Create `.env.local` file with:
```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# App
NEXT_PUBLIC_APP_URL=https://your-domain.com
```

## 📱 **Mobile Considerations**

### **Progressive Web App (PWA)**
The app is PWA-ready with:
- Service worker for offline support
- Manifest for mobile installation
- Responsive design for all screen sizes

### **Mobile Browsers**
- Tested on iOS Safari and Android Chrome
- Touch-friendly interface
- Mobile-optimized navigation

## 🔒 **Security Checklist**

### **Before Launch**
- [ ] Change default admin passwords
- [ ] Set up proper email provider (not Supabase default)
- [ ] Configure SSL/HTTPS (automatic on Vercel)
- [ ] Set up rate limiting
- [ ] Configure CORS properly
- [ ] Enable Row Level Security (RLS) on all tables
- [ ] Set up database backups

### **Ongoing**
- [ ] Regular security updates
- [ ] Monitor for suspicious activity
- [ ] Regular database backups
- [ ] Update dependencies monthly

## 📊 **Monitoring & Analytics**

### **Essential Monitoring**
1. **Error Tracking**: Sentry or LogRocket
2. **Performance**: Vercel Analytics or Google Lighthouse
3. **Uptime**: UptimeRobot or Pingdom
4. **Database**: Supabase dashboard metrics

### **User Analytics** (GDPR-compliant)
1. **Plausible Analytics**: Privacy-focused alternative to Google Analytics
2. **PostHog**: Open-source product analytics
3. **Simple Analytics**: GDPR-compliant

## 🔄 **CI/CD Pipeline**

### **GitHub Actions** (`.github/workflows/deploy.yml`)
```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: npm run build
      - run: npm run test
```

### **Testing**
- Unit tests: `npm test`
- Type checking: `npx tsc --noEmit`
- Linting: `npm run lint`

## 📈 **Scaling Considerations**

### **Free Tier Limits** (Supabase)
- 500MB database
- 50,000 monthly active users
- 2GB bandwidth/month
- Unlimited API requests

### **When to Upgrade**
- **10,000+ users**: Consider paid plan
- **High traffic**: Add CDN, optimize queries
- **Large families**: Monitor database size
- **International**: Add edge locations

### **Performance Optimization**
1. **Database Indexes**: Add indexes on frequently queried columns
2. **Image Optimization**: Use next/image component
3. **Code Splitting**: Automatic with Next.js
4. **CDN**: Vercel edge network

## 🚨 **Emergency Procedures**

### **Database Issues**
1. **Backup restore**: Use Supabase backup system
2. **Performance issues**: Check query performance in Supabase dashboard
3. **Connection issues**: Verify environment variables

### **App Issues**
1. **Rollback**: Vercel has instant rollback
2. **Downtime**: Check status.supabase.com
3. **Bugs**: Enable error tracking

### **Security Incidents**
1. **Breach suspected**: Rotate all API keys
2. **Malicious activity**: Block IPs, review logs
3. **Data leak**: Notify users, investigate source

## 📋 **Launch Checklist**

### **Pre-launch**
- [ ] Test all user flows
- [ ] Set up monitoring
- [ ] Configure backups
- [ ] Set up error tracking
- [ ] Test on mobile devices
- [ ] Verify SSL certificates
- [ ] Set up analytics
- [ ] Create admin accounts
- [ ] Test email notifications

### **Post-launch**
- [ ] Monitor performance
- [ ] Gather user feedback
- [ ] Fix critical bugs
- [ ] Plan first update
- [ ] Marketing launch
- [ ] User onboarding
- [ ] Support system

## 🆘 **Support & Documentation**

### **For Users**
1. **FAQ page**: Common questions and answers
2. **Help center**: Detailed guides
3. **Contact form**: User support
4. **Tutorial videos**: Onboarding help

### **For Developers**
1. **API documentation**
2. **Database schema**
3. **Deployment guide** (this document)
4. **Troubleshooting guide**

### **For Admins**
1. **Admin manual**
2. **Moderation tools**
3. **User management guide**
4. **Analytics dashboard**

---

## 🎉 **Ready to Launch!**

Your Family Planner app is ready for production. Follow these steps:

1. **Deploy** to Vercel (15 minutes)
2. **Set up** Supabase database (10 minutes)
3. **Configure** environment variables (5 minutes)
4. **Test** the live site (30 minutes)
5. **Launch** to beta users or public

**Need help?** Check the [Next.js deployment docs](https://nextjs.org/docs/deployment) or [Supabase guides](https://supabase.com/docs/guides).
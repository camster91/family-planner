/** @jest-environment jsdom */
import {useState} from 'react'
import {render, screen, waitFor} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {ListImagePicker} from '../ListImagePicker'
const url='/api/files/chores/abcdef0123456789.jpg'
function Harness(){const[value,setValue]=useState<string|null>(null);return <ListImagePicker value={value} onChange={setValue} onBusyChange={jest.fn()}/>}
it('uploads privately, previews and removes the image',async()=>{
 global.fetch=jest.fn(async()=>({ok:true,json:async()=>({url})})) as unknown as typeof fetch
 const user=userEvent.setup();const{container}=render(<Harness/>);await user.click(container.querySelector('summary')!)
 await user.upload(screen.getByLabelText('Choose list image'),new File(['fixture'],'cover.jpg',{type:'image/jpeg'}))
 expect((await screen.findByRole('img',{name:'Selected list image'})).getAttribute('src')).toBe(url)
 expect(fetch).toHaveBeenCalledWith('/api/upload',expect.objectContaining({method:'POST',body:expect.any(FormData)}))
 await user.click(screen.getByRole('button',{name:'Remove image'}));expect(screen.queryByRole('img')).toBeNull()
})
it('shows an upload error and permits retry',async()=>{
 global.fetch=jest.fn(async()=>({ok:false,json:async()=>({error:'Upload failed'})})) as unknown as typeof fetch
 const user=userEvent.setup();const{container}=render(<Harness/>);await user.click(container.querySelector('summary')!)
 await user.upload(screen.getByLabelText('Choose list image'),new File(['fixture'],'cover.jpg',{type:'image/jpeg'}))
 expect((await screen.findByRole('alert')).textContent).toContain('Upload failed')
 await waitFor(()=>expect((screen.getByRole('button',{name:'Add image'}) as HTMLButtonElement).disabled).toBe(false))
 expect(screen.queryByRole('img')).toBeNull()
})

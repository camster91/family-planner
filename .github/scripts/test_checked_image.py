import copy,hashlib,importlib.util,io,json,os,pathlib,tarfile,tempfile,unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('checked_image',pathlib.Path(__file__).parent/'checked-image.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
REVISION='a'*40
class CheckedImage(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.directory=pathlib.Path(self.temp.name);self.env=patch.dict(os.environ,{'RELEASE_SHA':REVISION,'GITHUB_RUN_ID':'42','GITHUB_RUN_ATTEMPT':'1'},clear=True);self.env.start();module.KIND='runtime'
 def tearDown(self):self.env.stop();self.temp.cleanup()
 def fixture(self,kind='runtime',user=None,command=None,tag=None):
  module.KIND=kind;settings={'User':user or 'nextjs','Labels':{'org.opencontainers.image.revision':REVISION},'Env':['RELEASE_SHA='+REVISION],'Cmd':['node'],'Entrypoint':['/app/docker-entrypoint.sh']}
  if command is not None:settings['Cmd']=command
  config={'config':settings,'architecture':'amd64','os':'linux','rootfs':{'type':'layers','diff_ids':['sha256:'+hashlib.sha256(b'layer').hexdigest()]}};raw=json.dumps(config).encode();image='sha256:'+hashlib.sha256(raw).hexdigest()
  with tarfile.open(self.directory/'runtime-image.tar','w') as bundle:
   for name,data in [('manifest.json',json.dumps([{'Config':'config.json','RepoTags':[tag or module.import_tag(REVISION)],'Layers':['layer.tar']}]).encode()),('config.json',raw),('layer.tar',b'layer')]:
    entry=tarfile.TarInfo(name);entry.size=len(data);bundle.addfile(entry,io.BytesIO(data))
  receipt={'schema':1,'repository':module.REPOSITORY,'revision':REVISION,'kind':kind,'image_id':image,'archive_sha256':module.digest(self.directory/'runtime-image.tar'),'workflow_run_id':'42','workflow_run_attempt':'1'};self.write(receipt);return receipt,config
 def write(self,receipt):(self.directory/'receipt.json').write_text(json.dumps(receipt))
 def test_accepts_checked_runtime(self):
  receipt,_=self.fixture();self.assertEqual(module.verify(self.directory),receipt)
 def test_rejects_tampered_archive_before_import(self):
  self.fixture();(self.directory/'runtime-image.tar').write_bytes(b'changed');self.assertRaises(ValueError,module.verify,self.directory)
 def test_rejects_wrong_repository_revision_kind_and_run(self):
  for field,value in [('repository','foreign/repo'),('revision','b'*40),('kind','role-init'),('workflow_run_id','99'),('workflow_run_attempt','2')]:
   receipt,_=self.fixture();receipt[field]=value;self.write(receipt);self.assertRaises(ValueError,module.verify,self.directory)
 def test_rejects_privileged_user_command_and_wrong_import_tag(self):
  for args in [{'user':'root'},{'command':['sh']},{'tag':'fleetvera:latest'}]:
   self.fixture(**args);self.assertRaises(ValueError,module.verify,self.directory)
 def test_rejects_forged_configuration_identity(self):
  receipt,_=self.fixture();receipt['image_id']='sha256:'+'f'*64;self.write(receipt);self.assertRaises(ValueError,module.verify,self.directory)
 def test_loaded_identity_allows_engine_manifest_ids_but_checks_contents(self):
  receipt,config=self.fixture();loaded={'Id':'sha256:'+'b'*64,'Config':config['config'],'RootFS':{'Layers':config['rootfs']['diff_ids']},'Architecture':'amd64','Os':'linux'}
  with patch.object(module.subprocess,'check_output',return_value=json.dumps([loaded])):self.assertEqual(module.verify_loaded(self.directory,receipt),loaded)
  loaded['RootFS']['Layers']=['sha256:'+'c'*64]
  with patch.object(module.subprocess,'check_output',return_value=json.dumps([loaded])):self.assertRaises(ValueError,module.verify_loaded,self.directory,receipt)
 def test_loaded_legacy_inspect_defaults_are_equivalent_to_absent_fields(self):
  receipt,config=self.fixture();loaded={'Id':'sha256:'+'b'*64,'Config':dict(config['config'],Hostname='',Domainname='',Image='',AttachStdin=False,AttachStdout=False,AttachStderr=False,Tty=False,OpenStdin=False,StdinOnce=False),'RootFS':{'Layers':config['rootfs']['diff_ids']},'Architecture':'amd64','Os':'linux'}
  with patch.object(module.subprocess,'check_output',return_value=json.dumps([loaded])):self.assertEqual(module.verify_loaded(self.directory,receipt),loaded)
  for field,value in [('Hostname','changed'),('AttachStdin',True),('AttachStdin',0),('Image',None)]:
   changed=copy.deepcopy(loaded);changed['Config'][field]=value
   with patch.object(module.subprocess,'check_output',return_value=json.dumps([changed])):self.assertRaises(ValueError,module.verify_loaded,self.directory,receipt)
 def test_loaded_runtime_configuration_changes_remain_rejected(self):
  receipt,config=self.fixture();loaded={'Config':config['config'],'RootFS':{'Layers':config['rootfs']['diff_ids']},'Architecture':'amd64','Os':'linux'}
  for field,value in [('User','root'),('Env',['RELEASE_SHA='+REVISION,'EVIL=1']),('Cmd',['sh']),('Entrypoint',['sh']),('Labels',{}),('Volumes',{'/app':{}}),('Healthcheck',{'Test':['NONE']})]:
   changed=copy.deepcopy(loaded);changed['Config'][field]=value
   with patch.object(module.subprocess,'check_output',return_value=json.dumps([changed])):self.assertRaises(ValueError,module.verify_loaded,self.directory,receipt)
 def test_documented_empty_or_nil_fields_match_absent_but_nonempty_remain(self):
  settings={'Volumes':None,'OnBuild':None,'Cmd':[],'Labels':{},'WorkingDir':''}
  self.assertEqual(module.comparable_configuration(settings),{})
  self.assertEqual(module.comparable_configuration({'Volumes':{'/data':{}},'OnBuild':['RUN evil'],'Cmd':['sh']}),{'Volumes':{'/data':{}},'OnBuild':['RUN evil'],'Cmd':['sh']})
 def test_publication_rejects_untrusted_event_and_source_before_docker(self):
  self.fixture()
  for changes in [{},{'GITHUB_EVENT_NAME':'pull_request','GITHUB_REF':'refs/heads/master','FP_DEFAULT_BRANCH':'master','GITHUB_REPOSITORY':module.REPOSITORY},{'GITHUB_EVENT_NAME':'push','GITHUB_REF':'refs/heads/main','FP_DEFAULT_BRANCH':'master','GITHUB_REPOSITORY':module.REPOSITORY},{'GITHUB_EVENT_NAME':'push','GITHUB_REF':'refs/heads/master','GITHUB_REPOSITORY':module.REPOSITORY},{'GITHUB_EVENT_NAME':'push','GITHUB_REF':'refs/heads/','FP_DEFAULT_BRANCH':'','GITHUB_REPOSITORY':module.REPOSITORY},{'GITHUB_EVENT_NAME':'push','GITHUB_REF':'refs/heads/master','FP_DEFAULT_BRANCH':'master','GITHUB_REPOSITORY':'foreign/repo'}]:
   with patch.dict(os.environ,changes),patch.object(module.subprocess,'run') as run:
    self.assertRaises(ValueError,module.publish,self.directory);run.assert_not_called()
 def test_publication_tags_preserve_each_build_attempt(self):
  receipt,_=self.fixture();first=module.publication_tag(receipt);receipt['workflow_run_attempt']='2';second=module.publication_tag(receipt)
  self.assertNotEqual(first,second);self.assertTrue(first.endswith('-run-42-attempt-1'));self.assertTrue(second.endswith('-run-42-attempt-2'))
  receipt['workflow_run_id']='foreign';self.assertRaises(ValueError,module.publication_tag,receipt)
 def test_publication_loads_verified_contents_and_never_rebuilds(self):
  receipt,config=self.fixture()
  loaded={'Id':'sha256:'+'b'*64,'Config':config['config'],'RootFS':{'Layers':config['rootfs']['diff_ids']},'Architecture':'amd64','Os':'linux'}
  pushed={**loaded,'RepoDigests':[module.REGISTRY+'@sha256:'+'d'*64]}
  with patch.dict(os.environ,{'GITHUB_EVENT_NAME':'push','GITHUB_REF':'refs/heads/master','FP_DEFAULT_BRANCH':'master','GITHUB_REPOSITORY':module.REPOSITORY}),patch.object(module.subprocess,'check_output',side_effect=[json.dumps([loaded]),json.dumps([pushed])]),patch.object(module.subprocess,'run') as run:
   result=module.publish(self.directory)
   self.assertEqual(result['registry_image'],pushed['RepoDigests'][0])
   commands=[call.args[0][2] for call in run.call_args_list]
   self.assertEqual(commands,['load','tag','push'])
   self.assertEqual(json.loads((self.directory/'release-receipt.json').read_text()),result)
 def test_changed_import_cannot_reach_registry_push(self):
  receipt,config=self.fixture();loaded={'Id':'sha256:'+'b'*64,'Config':{**config['config'],'User':'root'},'RootFS':{'Layers':config['rootfs']['diff_ids']},'Architecture':'amd64','Os':'linux'}
  with patch.dict(os.environ,{'GITHUB_EVENT_NAME':'push','GITHUB_REF':'refs/heads/master','FP_DEFAULT_BRANCH':'master','GITHUB_REPOSITORY':module.REPOSITORY}),patch.object(module.subprocess,'check_output',return_value=json.dumps([loaded])),patch.object(module.subprocess,'run') as run:
   self.assertRaises(ValueError,module.publish,self.directory)
   self.assertEqual([call.args[0][2] for call in run.call_args_list],['load'])
if __name__=='__main__':unittest.main()

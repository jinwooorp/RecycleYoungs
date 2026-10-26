"""Project reset decisions against synthetic Engine metadata; no real Docker/DB."""
import copy
import importlib.util
from pathlib import Path
import unittest
from urllib.parse import unquote, urlsplit

PROJECT='recycleyoungs-dev-check-aabbccdd'


def labels(**extra):
    return {'com.docker.compose.project':PROJECT,'org.recycleyoungs.environment':'local-development-v1',**extra}


class Engine:
    def __init__(self):
        self.calls=[]
        self.containers=[dict(Id='a'*64,Names=['/'+PROJECT+'-frontend-1'],Created=123,
            Image=PROJECT+'-frontend:local',ImageID='sha256:'+'b'*64,
            Labels=labels(**{'com.docker.compose.service':'frontend'}),
            Mounts=[dict(Type='volume',Name=PROJECT+'-db')],
            NetworkSettings={'Networks':{PROJECT+'-data':{'NetworkID':'c'*64}}})]
        self.volumes=[dict(Name=PROJECT+'-db',Driver='local',CreatedAt='stamp',Options=None,
            Labels=labels(**{'com.docker.compose.volume':'db'}))]
        self.networks=[dict(Id='c'*64,Name=PROJECT+'-data',Created='stamp',Driver='bridge',Options={},
            Labels=labels(**{'com.docker.compose.network':'data'}))]
        self.images={PROJECT+'-frontend:local':dict(Id='sha256:'+'b'*64,RepoTags=[PROJECT+'-frontend:local'],
            Config={'Labels':{'org.recycleyoungs.project':PROJECT,'org.recycleyoungs.artifact':'local-development-v1'}})}

    def request(self,method,path):
        self.calls.append((method,path));p=unquote(urlsplit(path).path)
        if p=='/containers/json':return copy.deepcopy(self.containers)
        if p=='/volumes':return {'Volumes':copy.deepcopy(self.volumes)}
        if p=='/networks':return copy.deepcopy(self.networks)
        if p.startswith('/images/') and method=='GET':
            ref=p[len('/images/'):-len('/json')]
            value=self.images.get(ref) or next((i for i in self.images.values() if i['Id']==ref),None)
            return copy.deepcopy(value)
        if method=='GET' and p.startswith('/volumes/'):
            return copy.deepcopy(next(v for v in self.volumes if v['Name']==p.split('/')[-1]))
        if method=='GET' and p.startswith('/networks/'):
            return copy.deepcopy(next(v for v in self.networks if v['Id']==p.split('/')[-1]))
        if method=='DELETE' and p.startswith('/containers/'):
            self.containers=[c for c in self.containers if c['Id']!=p.split('/')[-1]]
        if method=='DELETE' and p.startswith('/volumes/'):
            self.volumes=[v for v in self.volumes if v['Name']!=p.split('/')[-1]]
        if method=='DELETE' and p.startswith('/networks/'):
            self.networks=[n for n in self.networks if n['Id']!=p.split('/')[-1]]
        if method=='DELETE' and p.startswith('/images/'):
            self.images={k:v for k,v in self.images.items() if v['Id']!=p.split('/')[-1]}
        return None


class ResetTests(unittest.TestCase):
    def module(self):
        path=Path(__file__).resolve().parents[2]/'docker/api/reset_dev.py'
        self.assertTrue(path.is_file(),'explicit scoped reset required')
        spec=importlib.util.spec_from_file_location('reset_dev',path)
        m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

    def test_plan_never_mutates_and_selects_exact_owned_resources(self):
        m=self.module();e=Engine();plan=m.plan_reset(e,PROJECT)
        self.assertEqual([v['Name'] for v in plan['volumes']],[PROJECT+'-db'])
        self.assertEqual([i['Id'] for i in plan['images']],['sha256:'+'b'*64])
        self.assertTrue(all(method=='GET' for method,_ in e.calls))

    def test_foreign_labels_colliding_names_unknown_services_and_shared_resources_stop(self):
        m=self.module()
        for kind in ['foreign-volume','foreign-container','unknown-service','shared-volume','shared-network']:
            with self.subTest(kind=kind):
                e=Engine()
                if kind=='foreign-volume':e.volumes[0]['Labels']['com.docker.compose.project']='foreign'
                elif kind=='foreign-container':e.containers[0]['Labels']['org.recycleyoungs.environment']='foreign'
                elif kind=='unknown-service':e.containers[0]['Labels']['com.docker.compose.service']='unknown'
                else:
                    foreign=copy.deepcopy(e.containers[0]);foreign['Id']='d'*64;foreign['Names']=['/other'];foreign['Labels']={}
                    if kind=='shared-volume':foreign['NetworkSettings']={'Networks':{}}
                    else:foreign['Mounts']=[]
                    e.containers.append(foreign)
                with self.assertRaises(ValueError):m.plan_reset(e,PROJECT)
                self.assertTrue(all(method=='GET' for method,_ in e.calls))

    def test_apply_requires_matching_confirmation_and_unchanged_inventory_before_stop(self):
        m=self.module()
        for changed in [False,True]:
            e=Engine();plan=m.plan_reset(e,PROJECT)
            if changed:e.volumes[0]['CreatedAt']='replacement'
            with self.assertRaises(ValueError):m.apply_reset(e,plan,PROJECT if changed else 'wrong')
            self.assertTrue(all(method=='GET' for method,_ in e.calls))

    def test_apply_only_stops_and_removes_planned_ids_without_force_or_prune(self):
        m=self.module();e=Engine();plan=m.plan_reset(e,PROJECT);m.apply_reset(e,plan,PROJECT)
        mutations=[(method,path) for method,path in e.calls if method!='GET']
        self.assertEqual(mutations,[('POST','/containers/'+'a'*64+'/stop?t=30'),
            ('DELETE','/containers/'+'a'*64+'?v=false&force=false'),
            ('DELETE','/volumes/'+PROJECT+'-db?force=false'),
            ('DELETE','/networks/'+'c'*64),
            ('DELETE','/images/sha256%3A'+'b'*64+'?force=false&noprune=true')])

    def test_shared_or_unproven_images_are_preserved_and_legacy_owned_image_is_supported(self):
        m=self.module()
        for kind in ['foreign-tag','unproven','legacy']:
            with self.subTest(kind=kind):
                e=Engine();image=e.images[PROJECT+'-frontend:local']
                if kind=='foreign-tag':image['RepoTags'].append('other:keep')
                else:image['Config']['Labels']={}
                if kind=='unproven':e.containers=[]
                plan=m.plan_reset(e,PROJECT)
                self.assertEqual(len(plan['images']),1 if kind=='legacy' else 0)

    def test_foreign_or_protected_project_is_rejected_before_engine_request(self):
        m=self.module();e=Engine()
        for project in ['recycleyoungs-team-dev','recycleyoungs-api-dev','other']:
            with self.assertRaises(ValueError):m.plan_reset(e,project)
        self.assertEqual(e.calls,[])

    def test_reset_helper_is_preserved_but_concurrent_reset_stops(self):
        m=self.module();e=Engine();helper=copy.deepcopy(e.containers[0])
        helper.update(Id='f'*64,Names=['/'+PROJECT+'-reset-run-123abc'],Mounts=[],NetworkSettings={'Networks':{}},
                      Labels=labels(**{'com.docker.compose.service':'reset'}))
        e.containers.append(helper)
        self.assertEqual(len(m.plan_reset(e,PROJECT,'f'*12)['containers']),1)
        helper2=copy.deepcopy(helper);helper2['Id']='e'*64;e.containers.append(helper2)
        with self.assertRaisesRegex(ValueError,'RESET_CONCURRENT_OPERATOR_REJECTED'):m.plan_reset(e,PROJECT,'f'*12)

    def test_plan_redacts_commands_bind_paths_and_non_contract_labels(self):
        m=self.module();e=Engine();e.containers[0]['Command']='PRIVATE';e.containers[0]['Labels']['secret']='PRIVATE'
        e.containers[0]['Mounts'].append(dict(Type='bind',Source='PRIVATE'))
        import json
        self.assertNotIn('PRIVATE',json.dumps(m.plan_reset(e,PROJECT)))

    def test_retagged_image_is_not_accepted_using_stale_container_tag(self):
        m=self.module();e=Engine();image=e.images[PROJECT+'-frontend:local']
        image['Config']['Labels']={};image['Id']='sha256:'+'e'*64
        self.assertEqual(m.plan_reset(e,PROJECT)['images'],[])

    def test_new_volume_identity_after_container_removal_stops_without_deleting_volume(self):
        m=self.module();e=Engine();plan=m.plan_reset(e,PROJECT);request=e.request
        def changed(method,path):
            result=request(method,path)
            if method=='DELETE' and path.startswith('/containers/'):e.volumes[0]['CreatedAt']='replacement'
            return result
        e.request=changed
        with self.assertRaisesRegex(ValueError,'RESET_VOLUME_CHANGED'):m.apply_reset(e,plan,PROJECT)
        self.assertFalse(any(method=='DELETE' and path.startswith('/volumes/') for method,path in e.calls))

    def test_engine_failure_is_not_retried_and_next_phase_does_not_run(self):
        m=self.module();e=Engine();plan=m.plan_reset(e,PROJECT);request=e.request
        def failing(method,path):
            result=request(method,path)
            if method=='POST':raise OSError('fixture')
            return result
        e.request=failing
        with self.assertRaises(OSError):m.apply_reset(e,plan,PROJECT)
        self.assertEqual(sum(method=='POST' for method,_ in e.calls),1)
        self.assertFalse(any(method=='DELETE' for method,_ in e.calls))

    def test_new_project_resource_during_reset_prevents_complete_without_deleting_it(self):
        m=self.module();e=Engine();plan=m.plan_reset(e,PROJECT);request=e.request
        new=copy.deepcopy(e.containers[0]);new.update(Id='e'*64,Mounts=[],NetworkSettings={'Networks':{}})
        def appeared(method,path):
            result=request(method,path)
            if method=='DELETE' and path.startswith('/images/'):e.containers.append(new)
            return result
        e.request=appeared
        with self.assertRaisesRegex(ValueError,'RESET_NEW_RESOURCES_REMAIN'):m.apply_reset(e,plan,PROJECT)
        self.assertEqual([c['Id'] for c in e.containers],['e'*64])


if __name__=='__main__':unittest.main()

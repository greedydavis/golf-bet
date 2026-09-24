import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useApi } from '@/app/auth';
import { HoleTable, type Holes } from '@/components/HoleTable';
import { Empty, ErrorBox, Loading, PageTitle } from '@/components/ui';

export function CoursesPage() {
  const api = useApi();
  const courses = useQuery({ queryKey: ['courses'], queryFn: api.listCourses });
  return (
    <div>
      <PageTitle
        back="/more"
        action={
          <Link to="/courses/new" className="btn-primary min-h-9 px-3 text-sm">
            ＋ 新增
          </Link>
        }
      >
        球場
      </PageTitle>
      <p className="mb-3 text-sm text-gray-500">也可以在輸入成績時，從成績卡照片自動讀取 Par 與差點洞序並建檔。</p>
      {courses.isLoading && <Loading />}
      {courses.error && <ErrorBox error={courses.error} />}
      {courses.data?.length === 0 && <Empty>還沒有球場資料</Empty>}
      <ul className="space-y-3">
        {courses.data?.map((c) => (
          <li key={c.id}>
            <Link to={`/courses/${c.id}`} className="card block active:bg-gray-50">
              <div className="font-bold">{c.name}</div>
              <div className="text-sm text-gray-500">
                Par {c.pars.reduce((s, x) => s + x, 0)}・打過 {c.rounds} 場
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CourseEditPage() {
  const params = useParams();
  const id = params.id ? Number(params.id) : undefined;
  const api = useApi();
  const course = useQuery({ queryKey: ['course', id], queryFn: () => api.getCourse(id!), enabled: id !== undefined });

  if (id !== undefined && course.isLoading) return <Loading />;
  if (course.error) return <ErrorBox error={course.error} />;
  const initial = course.data ?? { name: '', pars: new Array(18).fill(4), hcpIndex: new Array(18).fill(null) };

  return (
    <div>
      <PageTitle back="/courses">{id ? initial.name : '新增球場'}</PageTitle>
      <CourseEditor key={id ?? 'new'} id={id} initial={initial} />
    </div>
  );
}

function CourseEditor({ id, initial }: { id?: number; initial: { name: string; pars: Holes; hcpIndex: Holes } }) {
  const api = useApi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState(initial.name);
  const [pars, setPars] = useState(initial.pars);
  const [hcp, setHcp] = useState(initial.hcpIndex);

  const done = () => {
    qc.invalidateQueries({ queryKey: ['courses'] });
    qc.invalidateQueries({ queryKey: ['course', id] });
    navigate('/courses');
  };
  const save = useMutation({ mutationFn: () => api.saveCourse({ id, name, pars, hcpIndex: hcp }), onSuccess: done });
  const remove = useMutation({ mutationFn: () => api.deleteCourse(id!), onSuccess: done });

  return (
    <div className="space-y-4">
      <div className="card">
        <label className="label">球場名稱</label>
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：○○高爾夫球場" />
      </div>
      <div className="card">
        <HoleTable
          pars={pars}
          hcpIndex={hcp}
          onChange={(p, h) => {
            setPars(p);
            setHcp(h);
          }}
        />
      </div>
      {save.error && <ErrorBox error={save.error} />}
      <button className="btn-primary w-full" onClick={() => save.mutate()} disabled={save.isPending}>
        儲存
      </button>
      {id && (
        <button
          className="btn-danger w-full"
          onClick={() => confirm(`刪除球場「${initial.name}」？（過去球局的資料不受影響）`) && remove.mutate()}
          disabled={remove.isPending}
        >
          刪除球場
        </button>
      )}
    </div>
  );
}
